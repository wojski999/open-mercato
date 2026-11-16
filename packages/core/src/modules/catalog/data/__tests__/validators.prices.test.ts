import { priceCreateSchema, priceKindCreateSchema, priceKindUpdateSchema, priceUpdateSchema } from '../validators'

const scope = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
}

const basePrice = {
  ...scope,
  productId: '44444444-4444-4444-8444-444444444444',
  currencyCode: 'USD',
  priceKindId: '55555555-5555-4555-8555-555555555555',
}

describe('price cross-field validators', () => {
  it('accepts a full payload with a quantity tier and validity window', () => {
    const result = priceCreateSchema.safeParse({
      ...basePrice,
      minQuantity: 10,
      maxQuantity: 50,
      unitPriceNet: '9.99',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-12-31T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('allows an open-ended maxQuantity ("and above")', () => {
    const result = priceCreateSchema.safeParse({
      ...basePrice,
      minQuantity: 10,
    })
    expect(result.success).toBe(true)
  })

  it('allows an open-ended endsAt (no expiry)', () => {
    const result = priceCreateSchema.safeParse({
      ...basePrice,
      startsAt: '2026-01-01T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects maxQuantity below minQuantity on create and update', () => {
    const createResult = priceCreateSchema.safeParse({
      ...basePrice,
      minQuantity: 10,
      maxQuantity: 5,
    })
    expect(createResult.success).toBe(false)
    if (!createResult.success) {
      expect(createResult.error.issues[0]?.path).toEqual(['maxQuantity'])
    }

    const updateResult = priceUpdateSchema.safeParse({
      id: '66666666-6666-4666-8666-666666666666',
      minQuantity: 10,
      maxQuantity: 5,
    })
    expect(updateResult.success).toBe(false)
  })

  it('rejects endsAt before startsAt on create and update', () => {
    const createResult = priceCreateSchema.safeParse({
      ...basePrice,
      startsAt: '2026-12-31T00:00:00.000Z',
      endsAt: '2026-01-01T00:00:00.000Z',
    })
    expect(createResult.success).toBe(false)
    if (!createResult.success) {
      expect(createResult.error.issues[0]?.path).toEqual(['endsAt'])
    }

    const updateResult = priceUpdateSchema.safeParse({
      id: '66666666-6666-4666-8666-666666666666',
      startsAt: '2026-12-31T00:00:00.000Z',
      endsAt: '2026-01-01T00:00:00.000Z',
    })
    expect(updateResult.success).toBe(false)
  })

  it('still allows partial updates that touch neither quantity nor date fields', () => {
    const result = priceUpdateSchema.safeParse({
      id: '66666666-6666-4666-8666-666666666666',
      unitPriceNet: '12.50',
    })
    expect(result.success).toBe(true)
  })
})

describe('price update schema clears optional bounds', () => {
  const priceId = '66666666-6666-4666-8666-666666666666'

  it('keeps an explicit null maxQuantity as a clear instead of rejecting it', () => {
    const result = priceUpdateSchema.safeParse({ id: priceId, maxQuantity: null })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveProperty('maxQuantity', null)
    }
  })

  it.each(['startsAt', 'endsAt'] as const)('keeps an explicit null %s instead of coercing it to the epoch', (field) => {
    const result = priceUpdateSchema.safeParse({ id: priceId, [field]: null })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveProperty(field, null)
    }
  })

  it('still validates the range when only one side is cleared', () => {
    expect(
      priceUpdateSchema.safeParse({ id: priceId, minQuantity: 10, maxQuantity: null, endsAt: null }).success,
    ).toBe(true)
    expect(priceUpdateSchema.safeParse({ id: priceId, maxQuantity: 0 }).success).toBe(false)
  })

  it('leaves omitted bounds out of a partial update', () => {
    const parsed = priceUpdateSchema.parse({ id: priceId, unitPriceNet: '12.50' })
    expect(parsed).not.toHaveProperty('maxQuantity')
    expect(parsed).not.toHaveProperty('startsAt')
    expect(parsed).not.toHaveProperty('endsAt')
  })
})

describe('price kind update schema', () => {
  const priceKindId = '77777777-7777-4777-8777-777777777777'

  it('leaves displayMode out when a partial update omits it', () => {
    const parsed = priceKindUpdateSchema.parse({ id: priceKindId, title: 'Renamed' })
    expect(parsed).toEqual({ id: priceKindId, title: 'Renamed' })
    expect(parsed).not.toHaveProperty('displayMode')
  })

  it('keeps an explicit displayMode and still validates it', () => {
    expect(priceKindUpdateSchema.parse({ id: priceKindId, displayMode: 'including-tax' }).displayMode).toBe(
      'including-tax',
    )
    expect(priceKindUpdateSchema.safeParse({ id: priceKindId, displayMode: 'bogus' }).success).toBe(false)
  })

  it('keeps the excluding-tax default on create', () => {
    const parsed = priceKindCreateSchema.parse({ ...scope, code: 'regular', title: 'Regular' })
    expect(parsed.displayMode).toBe('excluding-tax')
  })
})
