import type { EntityManager } from '@mikro-orm/postgresql'
import { seedCatalogPriceKinds } from '../seeds'

jest.mock('../../seed/examples', () => ({ seedCatalogExamples: jest.fn() }))

type PriceKindRow = {
  code: string
  title: string
  organizationId: string | null
  tenantId: string
  displayMode: string
  currencyCode: string | null
  isPromotion: boolean
  isActive: boolean
  deletedAt: Date | null
  updatedAt: Date
}

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

function buildRow(overrides: Partial<PriceKindRow>): PriceKindRow {
  return {
    code: 'regular',
    title: 'Regular',
    organizationId,
    tenantId,
    displayMode: 'including-tax',
    currencyCode: 'USD',
    isPromotion: false,
    isActive: true,
    deletedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function buildEm(rows: PriceKindRow[]) {
  const created: Record<string, unknown>[] = []
  const em = {
    find: jest.fn(async () => rows),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return data
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  return { em: em as unknown as EntityManager, created }
}

describe('seedCatalogPriceKinds', () => {
  it('leaves tenant-created price kinds untouched when re-run', async () => {
    const originalUpdatedAt = new Date('2026-02-02T00:00:00Z')
    const contract = buildRow({
      code: 'contract',
      title: 'Contract',
      isActive: true,
      updatedAt: originalUpdatedAt,
    })
    const inactiveCustom = buildRow({
      code: 'wholesale',
      title: 'Wholesale',
      isActive: false,
      updatedAt: originalUpdatedAt,
    })
    const regular = buildRow({ code: 'regular' })
    const sale = buildRow({ code: 'sale', title: 'Sale', isPromotion: true })
    const { em, created } = buildEm([contract, inactiveCustom, regular, sale])

    await seedCatalogPriceKinds(em, { tenantId, organizationId })

    expect(contract.deletedAt).toBeNull()
    expect(contract.isActive).toBe(true)
    expect(contract.updatedAt).toBe(originalUpdatedAt)
    expect(inactiveCustom.deletedAt).toBeNull()
    expect(inactiveCustom.isActive).toBe(false)
    expect(inactiveCustom.updatedAt).toBe(originalUpdatedAt)
    expect(created).toHaveLength(0)
  })

  it('still restores defaults and soft-deletes duplicate default codes', async () => {
    const regular = buildRow({ code: 'regular', title: 'Renamed', isActive: false, deletedAt: new Date() })
    const duplicateRegular = buildRow({ code: 'REGULAR' })
    const { em, created } = buildEm([regular, duplicateRegular])

    await seedCatalogPriceKinds(em, { tenantId, organizationId })

    expect(regular.title).toBe('Regular')
    expect(regular.isActive).toBe(true)
    expect(regular.deletedAt).toBeNull()
    expect(duplicateRegular.deletedAt).toBeInstanceOf(Date)
    expect(duplicateRegular.isActive).toBe(false)
    expect(created.map((row) => row.code)).toEqual(['sale'])
  })
})
