/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn().mockReturnValue({
    createForFeature: jest.fn().mockResolvedValue(undefined),
  }),
}))

jest.mock('../../notifications', () => ({
  notificationTypes: [],
}))

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn().mockResolvedValue(null),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEST_PAYMENT_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'

const REFUND_ERROR_KEY = 'sales.payments.refunded_exceeds_paid'
const CAPTURE_ERROR_KEY = 'sales.payments.captured_exceeds_amount'

function buildMockEm(): Record<string, unknown> {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(
      (_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: data.id ?? TEST_PAYMENT_ID })
    ),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: unknown) => ({ id })),
    transactional: jest.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(buildMockEm())),
  }
}

function buildOrder() {
  return {
    id: TEST_ORDER_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    deletedAt: null,
    currencyCode: 'USD',
    paymentMethodId: null,
    paymentMethodCode: null,
    orderNumber: 'ORD-001',
    grandTotalGrossAmount: '123',
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    outstandingAmount: '123',
  }
}

function buildStoredPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_PAYMENT_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    order: buildOrder(),
    paymentMethod: null,
    paymentReference: null,
    statusEntryId: null,
    status: null,
    amount: '100',
    currencyCode: 'USD',
    capturedAmount: '80',
    refundedAmount: '0',
    receivedAt: null,
    capturedAt: null,
    metadata: null,
    customFieldSetId: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildCtx() {
  const em = buildMockEm()
  const container = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      return {}
    }),
  }
  return {
    container,
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  }
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  return null
}

function expectBadRequest(error: unknown, key: string) {
  expect(error).toBeInstanceOf(CrudHttpError)
  const httpError = error as CrudHttpError
  expect(httpError.status).toBe(400)
  expect(httpError.body).toMatchObject({ error: key })
}

beforeAll(async () => {
  commandRegistry.clear?.()
  await import('../payments')
})

beforeEach(() => {
  ;(findOneWithDecryption as jest.Mock).mockReset()
  ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
  ;(findWithDecryption as jest.Mock).mockReset()
  ;(findWithDecryption as jest.Mock).mockResolvedValue([])
})

describe('sales.payments.create — amount bounds', () => {
  const runCreate = (payload: Record<string, unknown>) => {
    const execute = commandRegistry.get('sales.payments.create')?.execute
    if (!execute) throw new Error('sales.payments.create not registered')
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildOrder())
    return execute(
      { orderId: TEST_ORDER_ID, tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, currencyCode: 'USD', ...payload },
      buildCtx() as never,
    )
  }

  it('rejects a refund larger than the captured amount', async () => {
    const error = await captureError(() => runCreate({ amount: 50, capturedAmount: 50, refundedAmount: 400 }))
    expectBadRequest(error, REFUND_ERROR_KEY)
  })

  it('rejects a refund larger than the amount when nothing is captured', async () => {
    const error = await captureError(() => runCreate({ amount: 50, refundedAmount: 60 }))
    expectBadRequest(error, REFUND_ERROR_KEY)
  })

  it('rejects a captured amount larger than the payment amount', async () => {
    const error = await captureError(() => runCreate({ amount: 10, capturedAmount: 999 }))
    expectBadRequest(error, CAPTURE_ERROR_KEY)
  })

  it('accepts partial capture with a partial refund', async () => {
    const result = await runCreate({ amount: 100, capturedAmount: 80, refundedAmount: 30 })
    expect(result).toMatchObject({ paymentId: TEST_PAYMENT_ID })
  })

  it('accepts a full refund of the captured amount', async () => {
    const result = await runCreate({ amount: 100, capturedAmount: 100, refundedAmount: 100 })
    expect(result).toMatchObject({ paymentId: TEST_PAYMENT_ID })
  })
})

describe('sales.payments.update — amount bounds against stored values', () => {
  const runUpdate = (stored: Record<string, unknown>, patch: Record<string, unknown>) => {
    const execute = commandRegistry.get('sales.payments.update')?.execute
    if (!execute) throw new Error('sales.payments.update not registered')
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(stored)
    return execute(
      { id: TEST_PAYMENT_ID, tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, ...patch },
      buildCtx() as never,
    )
  }

  it('rejects a refund-only patch that exceeds the stored captured amount', async () => {
    const stored = buildStoredPayment()
    const error = await captureError(() => runUpdate(stored, { refundedAmount: 90 }))
    expectBadRequest(error, REFUND_ERROR_KEY)
    expect(stored.refundedAmount).toBe('0')
  })

  it('rejects an amount-only patch that drops below the stored captured amount', async () => {
    const stored = buildStoredPayment()
    const error = await captureError(() => runUpdate(stored, { amount: 50 }))
    expectBadRequest(error, CAPTURE_ERROR_KEY)
    expect(stored.amount).toBe('100')
  })

  it('accepts a refund-only patch within the stored captured amount', async () => {
    const stored = buildStoredPayment()
    await runUpdate(stored, { refundedAmount: 80 })
    expect(stored.refundedAmount).toBe('80')
  })

  it('accepts an unrelated edit of a legacy over-refunded payment that resends the same amounts', async () => {
    const stored = buildStoredPayment({ amount: '50', capturedAmount: '50', refundedAmount: '400' })
    await runUpdate(stored, { amount: 50, paymentReference: 'legacy-ref-updated' })
    expect(stored.paymentReference).toBe('legacy-ref-updated')
    expect(stored.refundedAmount).toBe('400')
  })

  it('still rejects an amount change on a legacy over-refunded payment', async () => {
    const stored = buildStoredPayment({ amount: '50', capturedAmount: '50', refundedAmount: '400' })
    const error = await captureError(() => runUpdate(stored, { amount: 40 }))
    expectBadRequest(error, CAPTURE_ERROR_KEY)
    expect(stored.amount).toBe('50')
  })
})
