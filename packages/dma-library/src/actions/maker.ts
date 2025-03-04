import { getActionHash } from '@deploy-configurations/utils/action-hash'
import { ActionCall, calldataTypes } from '@dma-library/types'

import { ActionFactory } from './action-factory'

const createAction = ActionFactory.create

// Import ActionCall as it assists type generation
export function openVault(args: { joinAddress: string }): ActionCall {
  return createAction(getActionHash('MakerOpenVault'), [calldataTypes.maker.Open], [args])
}
