import { z } from 'zod'

const Erc8004ServiceSchema = z.object({
  name: z.string(),
  endpoint: z.string().url(),
  version: z.string().optional(),
})

const Erc8004RegistrationEntrySchema = z.object({
  agentId: z.number(),
  agentRegistry: z.string(),
})

export const Erc8004RegistrationSchema = z.object({
  type: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string().url().optional(),
  services: z.array(Erc8004ServiceSchema),
  x402Support: z.boolean().optional(),
  active: z.boolean(),
  registrations: z.array(Erc8004RegistrationEntrySchema),
  supportedTrust: z.array(z.string()).optional(),
})

export type Erc8004Registration = z.infer<typeof Erc8004RegistrationSchema>

export const Erc8004FeedbackParamsSchema = z.object({
  agentId: z.bigint(),
  value: z.number().int(),
  valueDecimals: z.number().int().min(0).max(18),
  tag1: z.string().max(64),
  tag2: z.string().max(64),
  endpoint: z.string().url(),
  message: z.string().max(256).default(''),
  extraData: z.string().default('0x0000000000000000000000000000000000000000000000000000000000000000'),
})

export type Erc8004FeedbackParams = z.infer<typeof Erc8004FeedbackParamsSchema>
