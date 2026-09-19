import { z } from 'zod'

// Gemini's responseSchema is an OpenAPI subset with upper-case type names.
// Convert the JSON Schema that zod produces into that shape.

type JSONSchema = {
  type?: string | string[]
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  enum?: unknown[]
  description?: string
  minItems?: number
  maxItems?: number
}

export interface GeminiSchema {
  type: string
  properties?: Record<string, GeminiSchema>
  required?: string[]
  propertyOrdering?: string[]
  items?: GeminiSchema
  enum?: string[]
  description?: string
  nullable?: boolean
  minItems?: number
  maxItems?: number
}

function convert(node: JSONSchema): GeminiSchema {
  let type = node.type
  let nullable = false
  if (Array.isArray(type)) {
    nullable = type.includes('null')
    type = type.find((t) => t !== 'null')
  }
  if (!type) throw new Error('Schema node without a type is not supported by Gemini')

  const out: GeminiSchema = { type: type.toUpperCase() }
  if (nullable) out.nullable = true
  if (node.description) out.description = node.description
  if (node.enum) out.enum = node.enum.map(String)
  if (node.minItems !== undefined) out.minItems = node.minItems
  if (node.maxItems !== undefined) out.maxItems = node.maxItems
  if (node.items) out.items = convert(node.items)
  if (node.properties) {
    out.properties = Object.fromEntries(
      Object.entries(node.properties).map(([k, v]) => [k, convert(v)]),
    )
    // Keeps the model's output in the order fields are declared.
    out.propertyOrdering = Object.keys(node.properties)
    if (node.required?.length) out.required = node.required
  }
  return out
}

export function toGeminiSchema(schema: z.ZodType): GeminiSchema {
  return convert(z.toJSONSchema(schema) as JSONSchema)
}
