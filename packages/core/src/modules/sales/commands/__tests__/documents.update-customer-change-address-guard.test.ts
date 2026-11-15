/** @jest-environment node */

/**
 * Changing an order's customer also clears the billing and shipping addresses,
 * so the change must respect `orderAddressEditableStatuses` as well as
 * `orderCustomerEditableStatuses`. Resending the same customer, or changing the
 * customer of an order without addresses, touches no address and stays
 * governed by the customer guard only.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder, SalesQuote, SalesSettings } from '../../data/entities'
import '../documents'
import type { DocumentUpdateInput } from '../documents'
import { createSalesDocumentLockKyselyFixture } from './salesDocumentLockFixture'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    invalidateCrudCache: jest.fn(),
  }
})

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const QUOTE_ID = '66666666-6666-4666-8666-666666666666'
const CUSTOMER_ID = 'c0ffee22-2bad-4cab-8fed-22222222abcd'
const OTHER_CUSTOMER_ID = 'beefcafe-77ab-4cde-8f77-7777777fedcb'
const CONTACT_ID = '55555555-5555-4555-8555-555555555555'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const TENANT_ID = '44444444-4444-4444-8444-444444444444'
const BILLING_ADDRESS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SHIPPING_ADDRESS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const STATUS = 'confirmed'

const CUSTOMERS: Record<string, Record<string, unknown>> = {
  [CUSTOMER_ID]: { id: CUSTOMER_ID, kind: 'person', displayName: 'Customer One', primaryEmail: 'one@example.com' },
  [OTHER_CUSTOMER_ID]: { id: OTHER_CUSTOMER_ID, kind: 'person', displayName: 'Customer Two', primaryEmail: 'two@example.com' },
}

type DocumentRecord = Record<string, unknown>

type SettingsRecord = {
  orderCustomerEditableStatuses: string[] | null
  orderAddressEditableStatuses: string[] | null
}

type LookupWhere = { id?: string } | undefined

const KEPT_ADDRESSES = {
  billingAddressId: BILLING_ADDRESS_ID,
  shippingAddressId: SHIPPING_ADDRESS_ID,
  billingAddressSnapshot: { line1: '1 Main St' },
  shippingAddressSnapshot: { line1: '2 Dock Rd' },
}

const CLEARED_ADDRESSES = {
  billingAddressId: null,
  shippingAddressId: null,
  billingAddressSnapshot: null,
  shippingAddressSnapshot: null,
}

const ADDRESSES_LOCKED: SettingsRecord = {
  orderCustomerEditableStatuses: [STATUS],
  orderAddressEditableStatuses: ['draft'],
}

function makeDocument(kind: 'order' | 'quote'): DocumentRecord {
  return {
    id: kind === 'order' ? ORDER_ID : QUOTE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    ...(kind === 'order' ? { orderNumber: 'O-1' } : { quoteNumber: 'Q-1' }),
    status: STATUS,
    statusEntryId: null,
    customerEntityId: CUSTOMER_ID,
    customerContactId: CONTACT_ID,
    customerSnapshot: {
      customer: { id: CUSTOMER_ID, primaryEmail: 'one@example.com' },
      contact: { id: CONTACT_ID },
    },
    ...KEPT_ADDRESSES,
    currencyCode: 'USD',
    shippingMethodId: null,
    shippingMethodCode: null,
    shippingMethodSnapshot: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    paymentMethodSnapshot: null,
    comments: null,
    metadata: null,
    deletedAt: null,
  }
}

function makeEm(document: DocumentRecord, documentClass: unknown, settings: SettingsRecord | null) {
  const em: Record<string, unknown> = {
    findOne: jest.fn(async (requested: unknown, where: LookupWhere) => {
      if (requested === documentClass) return document
      if (requested === SalesSettings) return settings
      if (requested === CustomerEntity) {
        const customer = typeof where?.id === 'string' ? CUSTOMERS[where.id.toLowerCase()] : undefined
        return customer ? { primaryPhone: null, personProfile: null, companyProfile: null, ...customer } : null
      }
      return null
    }),
    find: jest.fn(async () => []),
    create: jest.fn((_entityClass: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    getReference: jest.fn((_entityClass: unknown, id: string) => ({ id })),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    fork: () => em,
    getKysely: () => createSalesDocumentLockKyselyFixture(String(document.id)),
  }
  return em
}

function makeCtx(em: unknown): CommandRuntimeContext {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  }
}

async function runUpdate(
  kind: 'order' | 'quote',
  input: Record<string, unknown>,
  settings: SettingsRecord | null,
  prepare: (document: DocumentRecord) => void = () => {},
) {
  const document = makeDocument(kind)
  prepare(document)
  const em = makeEm(document, kind === 'order' ? SalesOrder : SalesQuote, settings)
  const handler = commandRegistry.get<DocumentUpdateInput, unknown>(
    kind === 'order' ? 'sales.orders.update' : 'sales.quotes.update',
  )
  expect(handler).toBeTruthy()
  let error: unknown = null
  try {
    await handler!.execute({ id: document.id, ...input } as never, makeCtx(em))
  } catch (caught) {
    error = caught
  }
  return { document, error, em }
}

function clearAddresses(document: DocumentRecord) {
  Object.assign(document, CLEARED_ADDRESSES)
}

describe('sales order update — customer change respects the address-editable statuses', () => {
  it('rejects a customer change that would clear addresses when address editing is blocked for the status', async () => {
    const { document, error, em } = await runUpdate('order', { customerEntityId: OTHER_CUSTOMER_ID }, ADDRESSES_LOCKED)

    expect(error).toBeInstanceOf(CrudHttpError)
    expect((error as CrudHttpError).status).toBe(400)
    expect((error as CrudHttpError).body).toEqual({ error: 'sales.orders.edit_addresses_blocked' })
    expect(document).toMatchObject({
      customerEntityId: CUSTOMER_ID,
      customerContactId: CONTACT_ID,
      ...KEPT_ADDRESSES,
    })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects detaching the customer when address editing is blocked and addresses are assigned', async () => {
    const { document, error } = await runUpdate('order', { customerEntityId: null }, ADDRESSES_LOCKED)

    expect((error as CrudHttpError).body).toEqual({ error: 'sales.orders.edit_addresses_blocked' })
    expect(document).toMatchObject({ customerEntityId: CUSTOMER_ID, ...KEPT_ADDRESSES })
  })

  it.each([
    ['only a billing snapshot', { billingAddressSnapshot: { line1: '1 Main St' } }],
    ['only a shipping address id', { shippingAddressId: SHIPPING_ADDRESS_ID }],
  ])('rejects the customer change when the order holds %s', async (_label, remaining) => {
    const { error } = await runUpdate('order', { customerEntityId: OTHER_CUSTOMER_ID }, ADDRESSES_LOCKED, (stored) => {
      clearAddresses(stored)
      Object.assign(stored, remaining)
    })

    expect((error as CrudHttpError).body).toEqual({ error: 'sales.orders.edit_addresses_blocked' })
  })

  it('keeps accepting the same customer resent while address editing is blocked', async () => {
    const { document, error } = await runUpdate('order', { customerEntityId: CUSTOMER_ID.toUpperCase() }, ADDRESSES_LOCKED)

    expect(error).toBeNull()
    expect(document).toMatchObject({ customerEntityId: CUSTOMER_ID, customerContactId: CONTACT_ID, ...KEPT_ADDRESSES })
  })

  it('allows changing the customer of an order without addresses while address editing is blocked', async () => {
    const { document, error } = await runUpdate(
      'order',
      { customerEntityId: OTHER_CUSTOMER_ID },
      ADDRESSES_LOCKED,
      clearAddresses,
    )

    expect(error).toBeNull()
    expect(document).toMatchObject({ customerEntityId: OTHER_CUSTOMER_ID, customerContactId: null, ...CLEARED_ADDRESSES })
  })

  it.each([
    ['address editing is allowed for the status', { ...ADDRESSES_LOCKED, orderAddressEditableStatuses: [STATUS] }],
    ['no address-editable statuses are configured', { ...ADDRESSES_LOCKED, orderAddressEditableStatuses: null }],
    ['no sales settings exist', null],
  ])('clears the addresses on a customer change when %s', async (_label, settings) => {
    const { document, error } = await runUpdate('order', { customerEntityId: OTHER_CUSTOMER_ID }, settings)

    expect(error).toBeNull()
    expect(document).toMatchObject({ customerEntityId: OTHER_CUSTOMER_ID, customerContactId: null, ...CLEARED_ADDRESSES })
  })

  it('still reports the customer guard first when customer editing is blocked too', async () => {
    const { error } = await runUpdate('order', { customerEntityId: OTHER_CUSTOMER_ID }, {
      orderCustomerEditableStatuses: ['draft'],
      orderAddressEditableStatuses: ['draft'],
    })

    expect((error as CrudHttpError).body).toEqual({ error: 'sales.orders.edit_customer_blocked' })
  })

  it('leaves quotes unaffected by the order address guard', async () => {
    const { document, error } = await runUpdate('quote', { customerEntityId: OTHER_CUSTOMER_ID }, ADDRESSES_LOCKED)

    expect(error).toBeNull()
    expect(document).toMatchObject({ customerEntityId: OTHER_CUSTOMER_ID, ...CLEARED_ADDRESSES })
  })
})
