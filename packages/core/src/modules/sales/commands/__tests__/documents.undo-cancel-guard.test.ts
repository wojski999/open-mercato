/** @jest-environment node */

/**
 * Regression test for issue #7389.
 *
 * `sales.orders.update` refuses to move an order into a cancelled status while it still has
 * a live shipment or an unrefunded payment (#4054). Undoing an earlier update that reopened a
 * cancelled order restored the old snapshot directly, so the undo put the order back into the
 * cancelled status without that check. Shipments and payments can be recorded on an order that
 * is already cancelled, and the update that reopens it leaves them unchanged, so the undo's
 * staleness check does not catch this.
 */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { createSalesDocumentLockKyselyFixture } from './salesDocumentLockFixture'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_order: 'sales.sales_order',
      sales_order_line: 'sales.sales_order_line',
      sales_order_adjustment: 'sales.sales_order_adjustment',
      sales_payment: 'sales.sales_payment',
      sales_shipment: 'sales.sales_shipment',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))

const encryptionMocks = {
  findWithDecryption: jest.fn(async () => [] as unknown[]),
  findOneWithDecryption: jest.fn(async () => null as unknown),
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => encryptionMocks)

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-accc-cccccccccccc'
const PAYMENT_ID = 'dddddddd-dddd-4ddd-addd-dddddddddddd'
const SHIPMENT_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'
const CANCELED_ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const CONFIRMED_ENTRY_ID = '66666666-6666-4666-8666-666666666666'

type Row = Record<string, unknown>

function storedOrder(status: 'canceled' | 'confirmed'): Row {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    orderNumber: 'SO-1',
    status,
    statusEntryId: status === 'canceled' ? CANCELED_ENTRY_ID : CONFIRMED_ENTRY_ID,
    currencyCode: 'USD',
    totalsMode: 'computed',
    subtotalNetAmount: '0',
    subtotalGrossAmount: '0',
    discountTotalAmount: '0',
    taxTotalAmount: '0',
    shippingNetAmount: '0',
    shippingGrossAmount: '0',
    surchargeTotalAmount: '0',
    grandTotalNetAmount: '0',
    grandTotalGrossAmount: '0',
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    outstandingAmount: '0',
    lineItemCount: 0,
    deletedAt: null,
  }
}

function storedPayment(overrides: Row = {}): Row {
  return {
    id: PAYMENT_ID,
    order: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    paymentMethod: null,
    paymentReference: null,
    statusEntryId: null,
    status: 'captured',
    amount: '100',
    currencyCode: 'USD',
    capturedAmount: '100',
    refundedAmount: '0',
    receivedAt: null,
    capturedAt: null,
    metadata: null,
    customFieldSetId: null,
    allocations: [],
    ...overrides,
  }
}

function storedShipment(overrides: Row = {}): Row {
  return {
    id: SHIPMENT_ID,
    order: { id: ORDER_ID },
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    shipmentNumber: 'SH-1',
    statusEntryId: null,
    status: 'shipped',
    items: [],
    itemsSnapshot: null,
    metadata: null,
    customFieldSetId: null,
    ...overrides,
  }
}

function buildHarness(options: { order: Row; payments?: Row[]; shipments?: Row[] }) {
  const { order } = options
  const payments = options.payments ?? []
  const shipments = options.shipments ?? []
  const nativeDeletes: string[] = []

  const rowsFor = (entity: unknown): Row[] => {
    const name = (entity as { name?: string })?.name ?? ''
    if (name === 'SalesPayment') return payments
    if (name === 'SalesShipment') return shipments
    return []
  }
  const oneFor = (entity: unknown, where: Row | undefined): Row | null => {
    const name = (entity as { name?: string })?.name ?? ''
    if (name === 'SalesOrder') return order
    return rowsFor(entity).find((row) => row.id === where?.id) ?? null
  }

  let em: Row
  em = {
    fork: () => em,
    create: (_entity: unknown, data: Row) => ({ ...data }),
    persist: () => undefined,
    remove: () => undefined,
    find: async (entity: unknown) => rowsFor(entity),
    findOne: async (entity: unknown, where: Row) => oneFor(entity, where),
    count: async () => 0,
    nativeDelete: async (entity: unknown) => {
      nativeDeletes.push((entity as { name?: string })?.name ?? '')
      return 0
    },
    flush: async () => undefined,
    begin: async () => undefined,
    transactional: async (work: (tx: Row) => Promise<unknown>) => work(em),
    clear: () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    getReference: (_entity: unknown, id: unknown) => ({ id }),
    getKysely: () => createSalesDocumentLockKyselyFixture(ORDER_ID),
    getUnitOfWork: () => ({ unsetIdentity: () => undefined }),
  }

  encryptionMocks.findOneWithDecryption.mockImplementation((async (
    _em: unknown,
    entity: unknown,
    where: Row,
  ) => oneFor(entity, where)) as never)
  encryptionMocks.findWithDecryption.mockImplementation((async (_em: unknown, entity: unknown) =>
    rowsFor(entity)) as never)

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({}),
    cache: asValue(undefined),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }

  return { ctx, order, nativeDeletes }
}

const updateCommand = () => commandRegistry.get('sales.orders.update')!

async function snapshotOf(harness: ReturnType<typeof buildHarness>): Promise<unknown> {
  const prepared = (await updateCommand().prepare?.(
    { id: ORDER_ID, statusEntryId: CONFIRMED_ENTRY_ID } as never,
    harness.ctx,
  )) as { before?: unknown }
  expect(prepared?.before).toBeTruthy()
  return prepared.before
}

async function undoReopen(stored: { payments?: Row[]; shipments?: Row[] }) {
  const beforeReopen = buildHarness({ order: storedOrder('canceled'), ...stored })
  const before = await snapshotOf(beforeReopen)
  const reopened = buildHarness({ order: storedOrder('confirmed'), ...stored })
  const after = await snapshotOf(reopened)
  const result = updateCommand().undo!({
    logEntry: { payload: { undo: { before, after } } },
    ctx: reopened.ctx,
  } as never)
  return { reopened, result }
}

describe('sales.orders.update undo — cancellation guard (issue #7389)', () => {
  beforeAll(async () => {
    await import('../documents')
  })

  beforeEach(() => {
    encryptionMocks.findOneWithDecryption.mockReset()
    encryptionMocks.findWithDecryption.mockReset()
  })

  it('refuses to restore a cancelled status while a payment is not refunded', async () => {
    const { reopened, result } = await undoReopen({ payments: [storedPayment()] })

    await expect(result).rejects.toMatchObject({
      status: 409,
      body: { error: 'sales.orders.errors.cancel_has_payments' },
    })
    expect(reopened.order.status).toBe('confirmed')
    expect(reopened.nativeDeletes).not.toContain('SalesPayment')
  })

  it('refuses to restore a cancelled status while a shipment is still live', async () => {
    const { reopened, result } = await undoReopen({ shipments: [storedShipment()] })

    await expect(result).rejects.toMatchObject({
      status: 409,
      body: { error: 'sales.orders.errors.cancel_has_shipments' },
    })
    expect(reopened.order.status).toBe('confirmed')
    expect(reopened.nativeDeletes).not.toContain('SalesShipment')
  })

  it('restores the cancelled status once payments are refunded and shipments returned', async () => {
    const { reopened, result } = await undoReopen({
      payments: [storedPayment({ refundedAmount: '100' })],
      shipments: [storedShipment({ status: 'returned' })],
    })

    await expect(result).resolves.toBeUndefined()
    expect(reopened.order.status).toBe('canceled')
  })
})
