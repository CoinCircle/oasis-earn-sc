import { getAavePaybackWithdrawV3OperationDefinition } from '@deploy-configurations/operation-definitions'
import { Network } from '@deploy-configurations/types/network'
import { MAX_UINT, ZERO } from '@dma-common/constants'
import { actions } from '@dma-library/actions'
import { AaveLikeStrategyAddresses } from '@dma-library/operations/aave-like'
import { IOperation } from '@dma-library/types'
import BigNumber from 'bignumber.js'

type PaybackWithdrawArgs = {
  amountCollateralToWithdrawInBaseUnit: BigNumber
  amountDebtToPaybackInBaseUnit: BigNumber
  isPaybackAll: boolean
  collateralTokenAddress: string
  collateralIsEth: boolean
  debtTokenAddress: string
  debtTokenIsEth: boolean
  proxy: string
  user: string
  addresses: AaveLikeStrategyAddresses
  network: Network
}

export type AaveV3PaybackWithdrawOperation = (args: PaybackWithdrawArgs) => Promise<IOperation>

export const paybackWithdraw: AaveV3PaybackWithdrawOperation = async args => {
  const { network } = args
  const pullDebtTokensToProxy = actions.common.pullToken(network, {
    asset: args.debtTokenAddress,
    amount: args.amountDebtToPaybackInBaseUnit,
    from: args.user,
  })
  const setDebtApprovalOnLendingPool = actions.common.setApproval(network, {
    amount: args.amountDebtToPaybackInBaseUnit,
    asset: args.debtTokenAddress,
    delegate: args.addresses.lendingPool,
    sumAmounts: false,
  })
  const wrapEth = actions.common.wrapEth(network, {
    amount: args.amountDebtToPaybackInBaseUnit,
  })
  const paybackDebt = actions.aave.v3.aaveV3Payback(args.network, {
    asset: args.debtTokenAddress,
    amount: args.amountDebtToPaybackInBaseUnit,
    paybackAll: args.isPaybackAll,
  })
  const unwrapEthDebt = actions.common.unwrapEth(network, {
    amount: new BigNumber(MAX_UINT),
  })
  const returnLeftFundFromPayback = actions.common.returnFunds(network, {
    asset: args.debtTokenIsEth ? args.addresses.tokens.ETH : args.debtTokenAddress,
  })

  const withdrawCollateralFromAAVE = actions.aave.v3.aaveV3Withdraw(args.network, {
    asset: args.collateralTokenAddress,
    amount: args.amountCollateralToWithdrawInBaseUnit,
    to: args.proxy,
  })
  const unwrapEth = actions.common.unwrapEth(network, {
    amount: new BigNumber(MAX_UINT),
  })

  const returnFunds = actions.common.returnFunds(network, {
    asset: args.collateralIsEth ? args.addresses.tokens.ETH : args.collateralTokenAddress,
  })

  pullDebtTokensToProxy.skipped =
    args.amountDebtToPaybackInBaseUnit.lte(ZERO) || args.debtTokenIsEth
  setDebtApprovalOnLendingPool.skipped = args.amountDebtToPaybackInBaseUnit.lte(ZERO)
  wrapEth.skipped = args.amountDebtToPaybackInBaseUnit.lte(ZERO) || !args.debtTokenIsEth
  paybackDebt.skipped = args.amountDebtToPaybackInBaseUnit.lte(ZERO)
  unwrapEthDebt.skipped = args.amountDebtToPaybackInBaseUnit.lte(ZERO) || !args.debtTokenIsEth
  returnLeftFundFromPayback.skipped = args.amountDebtToPaybackInBaseUnit.lte(ZERO)

  withdrawCollateralFromAAVE.skipped = args.amountCollateralToWithdrawInBaseUnit.lte(ZERO)
  unwrapEth.skipped = args.amountCollateralToWithdrawInBaseUnit.lte(ZERO) || !args.collateralIsEth
  returnFunds.skipped = args.amountCollateralToWithdrawInBaseUnit.lte(ZERO)

  const calls = [
    pullDebtTokensToProxy,
    setDebtApprovalOnLendingPool,
    wrapEth,
    paybackDebt,
    unwrapEthDebt,
    returnLeftFundFromPayback,
    withdrawCollateralFromAAVE,
    unwrapEth,
    returnFunds,
  ]

  return {
    calls: calls,
    operationName: getAavePaybackWithdrawV3OperationDefinition(args.network).name,
  }
}
