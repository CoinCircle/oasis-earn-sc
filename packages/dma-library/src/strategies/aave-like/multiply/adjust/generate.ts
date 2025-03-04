import { FEE_ESTIMATE_INFLATOR, ONE, ZERO } from '@dma-common/constants'
import { amountFromWei } from '@dma-common/utils/common'
import { calculateFee } from '@dma-common/utils/swap'
import BigNumber from 'bignumber.js'

import { GenerateArgs, IAdjustStrategy } from './types'

export async function generate({
  isIncreasingRisk,
  swapData,
  operation,
  collectFeeFrom,
  fee,
  simulation,
  args,
}: GenerateArgs): Promise<IAdjustStrategy> {
  const fromTokenPrecision = isIncreasingRisk
    ? args.debtToken.precision
    : args.collateralToken.precision
  const toTokenPrecision = isIncreasingRisk
    ? args.collateralToken.precision
    : args.debtToken.precision

  const fromTokenAmountNormalised = amountFromWei(swapData.fromTokenAmount, fromTokenPrecision)
  const toTokenAmountNormalisedWithMaxSlippage = amountFromWei(
    swapData.minToTokenAmount,
    toTokenPrecision,
  )

  const expectedMarketPriceWithSlippage = fromTokenAmountNormalised.div(
    toTokenAmountNormalisedWithMaxSlippage,
  )

  const finalPosition = simulation.position

  // When collecting fees from the target token (collateral here), we want to calculate the fee
  // Based on the toTokenAmount NOT minToTokenAmount so that we overestimate the fee where possible
  // And do not mislead the user
  const shouldCollectFeeFromSourceToken = collectFeeFrom === 'sourceToken'
  const sourceTokenAmount = isIncreasingRisk ? simulation.delta.debt : simulation.delta.collateral

  const preSwapFee = shouldCollectFeeFromSourceToken
    ? (args.fee || calculateFee(sourceTokenAmount, fee.toNumber()))
    : ZERO
  const postSwapFee = shouldCollectFeeFromSourceToken
    ? ZERO
    : (args.fee || calculateFee(swapData.toTokenAmount, fee.toNumber()))

  return {
    transaction: {
      calls: operation.calls,
      operationName: operation.operationName,
    },
    simulation: {
      delta: simulation.delta,
      swap: {
        ...simulation.swap,
        ...swapData,
        collectFeeFrom,
        tokenFee: preSwapFee.plus(
          postSwapFee.times(ONE.plus(FEE_ESTIMATE_INFLATOR)).integerValue(BigNumber.ROUND_DOWN),
        ),
      },
      position: finalPosition,
      minConfigurableRiskRatio: finalPosition.minConfigurableRiskRatio(
        expectedMarketPriceWithSlippage,
      ),
    },
    flashloan: {
      amount: simulation.flashloan.amount,
      token: simulation.flashloan.token,
    },
  }
}
