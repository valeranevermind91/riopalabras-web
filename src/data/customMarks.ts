import type { RioRegion } from './rio'

// What a custom word may say about where and how it is used. The user_words columns carry CHECKs for the same values,
// and /enrich returns only these (anything else it is given becomes null).

/** The registers of the Rioplatense overlay (tools/rio-overlay/schema.mjs). */
export const CUSTOM_REGISTERS = ['neutral', 'informal', 'vulgar', 'offensive', 'pejorative'] as const
export type CustomRegister = (typeof CUSTOM_REGISTERS)[number]

export const CUSTOM_REGIONS: readonly RioRegion[] = ['ar', 'uy']

/** 'ar' or 'uy' as stored, else null (null means both countries, or not known). */
export const customRegion = (value: unknown): RioRegion | null => (typeof value === 'string' && (CUSTOM_REGIONS as readonly string[]).includes(value.trim()) ? (value.trim() as RioRegion) : null)

/** A register as stored, else null. */
export const customRegister = (value: unknown): CustomRegister | null => (typeof value === 'string' ? (CUSTOM_REGISTERS.find((r) => r === value.trim()) ?? null) : null)
