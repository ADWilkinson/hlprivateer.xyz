export { type SupportedChainId, IDENTITY_REGISTRY, REPUTATION_REGISTRY } from './addresses'
export { identityRegistryAbi, reputationRegistryAbi } from './abis'
export {
  Erc8004RegistrationSchema,
  type Erc8004Registration,
  Erc8004FeedbackParamsSchema,
  type Erc8004FeedbackParams,
} from './schemas'
export {
  createIdentityClient,
  createReputationClient,
  type Erc8004ClientConfig,
} from './client'
