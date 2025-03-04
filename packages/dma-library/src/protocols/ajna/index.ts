import { ONE, ZERO } from '@dma-common/constants'
import { negativeToZero } from '@dma-common/utils/common'
import { ajnaBuckets } from '@dma-library/strategies'
import { getAjnaEarnValidations } from '@dma-library/strategies/ajna/earn/validations'
import {
  getLiquidityInLupBucket,
  getPoolLiquidity,
  getTotalPoolLiquidity,
} from '@dma-library/strategies/ajna/validation/borrowish/notEnoughLiquidity'
import { SwapData } from '@dma-library/types'
import {
  AjnaCommonDependencies,
  AjnaCommonDMADependencies,
  AjnaEarnActions,
  AjnaEarnPayload,
  AjnaEarnPosition,
  AjnaError,
  AjnaNotice,
  AjnaPool,
  AjnaStrategy,
  AjnaSuccess,
  AjnaWarning,
} from '@dma-library/types/ajna'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'

export const prepareAjnaDMAPayload = <T extends { pool: AjnaPool }>({
  dependencies,
  targetPosition,
  errors,
  warnings,
  data,
  txValue,
  swaps,
}: {
  dependencies: AjnaCommonDMADependencies
  targetPosition: T
  errors: AjnaError[]
  warnings: AjnaWarning[]
  notices: AjnaNotice[]
  successes: AjnaSuccess[]
  data: string
  txValue: string
  swaps: (SwapData & { collectFeeFrom: 'sourceToken' | 'targetToken'; tokenFee: BigNumber })[]
}): AjnaStrategy<T> => {
  return {
    simulation: {
      swaps: swaps.map(swap => ({
        fromTokenAddress: swap.fromTokenAddress,
        toTokenAddress: swap.toTokenAddress,
        fromTokenAmount: swap.fromTokenAmount,
        toTokenAmount: swap.toTokenAmount,
        minToTokenAmount: swap.minToTokenAmount,
        exchangeCalldata: swap.exchangeCalldata,
        collectFeeFrom: swap.collectFeeFrom,
        fee: swap.tokenFee,
      })),
      errors,
      warnings,
      notices: [],
      successes: [],
      targetPosition,
      position: targetPosition,
    },
    tx: {
      to: dependencies.operationExecutor,
      data,
      value: txValue,
    },
  }
}

export const prepareAjnaPayload = <T extends { pool: AjnaPool }>({
  dependencies,
  targetPosition,
  errors,
  warnings,
  notices,
  successes,
  data,
  txValue,
}: {
  dependencies: AjnaCommonDependencies
  targetPosition: T
  errors: AjnaError[]
  warnings: AjnaWarning[]
  notices: AjnaNotice[]
  successes: AjnaSuccess[]
  data: string
  txValue: string
}): AjnaStrategy<T> => {
  return {
    simulation: {
      swaps: [],
      errors,
      warnings,
      notices,
      successes,
      targetPosition,
      position: targetPosition,
    },
    tx: {
      to: dependencies.ajnaProxyActions,
      data,
      value: txValue,
    },
  }
}

export const getAjnaEarnActionOutput = async ({
  targetPosition,
  data,
  dependencies,
  args,
  action,
  txValue,
}: {
  targetPosition: AjnaEarnPosition
  data: string
  dependencies: AjnaCommonDependencies
  args: AjnaEarnPayload
  action: AjnaEarnActions
  txValue: string
}) => {
  const afterLupIndex = ['deposit-earn', 'withdraw-earn'].includes(action)
    ? calculateNewLupWhenAdjusting(args.position.pool, args.position, targetPosition).newLupIndex
    : undefined

  const { errors, warnings, notices, successes } = getAjnaEarnValidations({
    price: args.price,
    quoteAmount: args.quoteAmount,
    quoteTokenPrecision: args.quoteTokenPrecision,
    position: args.position,
    simulation: targetPosition,
    afterLupIndex,
    action,
  })

  return prepareAjnaPayload({
    dependencies,
    targetPosition,
    errors,
    warnings,
    notices,
    successes,
    data,
    txValue,
  })
}

export const resolveAjnaEthAction = (isUsingEth: boolean, amount: BigNumber) =>
  isUsingEth ? ethers.utils.parseEther(amount.toString()).toString() : '0'

export const calculateAjnaApyPerDays = (amount: BigNumber, apy: BigNumber, days: number) =>
  amount
    // converted to numbers because BigNumber doesn't handle power with decimals
    .times(new BigNumber(Math.E ** apy.times(days).toNumber()))
    .minus(amount)
    .div(amount)

// The origination fee is calculated as the greatest of the current annualized
// borrower interest rate divided by 52 (one week of interest) or 5 bps multiplied by the loan’s new
// debt.
export const getAjnaBorrowOriginationFee = ({
  interestRate,
  quoteAmount,
}: {
  interestRate: BigNumber
  quoteAmount: BigNumber
}) => {
  const weeklyInterestRate = interestRate.div(52)
  const fiveBasisPoints = new BigNumber(0.0005)

  return BigNumber.max(weeklyInterestRate, fiveBasisPoints).times(quoteAmount)
}

function getSimulationPoolOutput(
  positionCollateral: BigNumber,
  positionDebt: BigNumber,
  debtChange: BigNumber,
  pool: AjnaPool,
  newLup: BigNumber,
  newLupIndex: BigNumber,
) {
  const thresholdPrice = !positionCollateral.eq(0)
    ? positionDebt.dividedBy(positionCollateral)
    : ZERO

  const newHtp = thresholdPrice.gt(pool.htp) ? thresholdPrice : pool.htp

  return {
    ...pool,
    lup: newLup,
    lowestUtilizedPrice: newLup,
    lowestUtilizedPriceIndex: newLupIndex,
    htp: newHtp,
    highestThresholdPrice: newHtp,
    // TODO this is old index, we need to map newHtp to index
    highestThresholdPriceIndex: pool.highestThresholdPriceIndex,

    debt: pool.debt.plus(debtChange),
  }
}

function getMaxGenerate(
  pool: AjnaPool,
  positionDebt: BigNumber,
  positionCollateral: BigNumber,
  maxDebt: BigNumber = ZERO,
): BigNumber {
  const initialMaxDebt = positionCollateral.times(pool.lowestUtilizedPrice).minus(positionDebt)

  const liquidityAvailableInLupBucket = getLiquidityInLupBucket(pool)

  if (initialMaxDebt.lte(liquidityAvailableInLupBucket)) {
    return initialMaxDebt.isNegative() ? maxDebt : initialMaxDebt.plus(maxDebt)
  }

  const sortedBuckets = [...pool.buckets].sort((a, b) => a.index.minus(b.index).toNumber())

  const lupBucketArrayIndex = sortedBuckets.findIndex(bucket =>
    bucket.index.isEqualTo(pool.lowestUtilizedPriceIndex),
  )

  const bucketBelowLup = sortedBuckets[lupBucketArrayIndex + 1]

  if (!bucketBelowLup) {
    return maxDebt.plus(liquidityAvailableInLupBucket)
  }

  const newPool = getSimulationPoolOutput(
    positionCollateral,
    positionDebt,
    liquidityAvailableInLupBucket,
    pool,
    bucketBelowLup.price,
    bucketBelowLup.index,
  )

  return getMaxGenerate(
    newPool,
    positionDebt.plus(liquidityAvailableInLupBucket),
    positionCollateral,
    liquidityAvailableInLupBucket.plus(maxDebt),
  )
}

export function calculateMaxGenerate(
  pool: AjnaPool,
  positionDebt: BigNumber,
  collateralAmount: BigNumber,
) {
  const maxDebtWithoutFee = getMaxGenerate(pool, positionDebt, collateralAmount)

  const originationFee = getAjnaBorrowOriginationFee({
    interestRate: pool.interestRate,
    quoteAmount: maxDebtWithoutFee,
  })

  const poolLiquidity = getPoolLiquidity({
    buckets: pool.buckets,
    debt: pool.debt,
  })
  const poolLiquidityWithFee = poolLiquidity.minus(originationFee)
  const maxDebtWithFee = maxDebtWithoutFee.minus(originationFee)

  if (poolLiquidityWithFee.lt(maxDebtWithFee)) {
    return negativeToZero(poolLiquidityWithFee)
  }

  return negativeToZero(maxDebtWithFee)
}

export function calculateNewLup(pool: AjnaPool, debtChange: BigNumber): [BigNumber, BigNumber] {
  const sortedBuckets = [...pool.buckets].sort((a, b) => a.index.minus(b.index).toNumber())
  const totalPoolLiquidity = getTotalPoolLiquidity(pool.buckets)

  let remainingDebt = pool.debt.plus(debtChange)
  let newLup = sortedBuckets[0] ? sortedBuckets[0].price : pool.lowestUtilizedPrice
  let newLupIndex = sortedBuckets[0] ? sortedBuckets[0].index : pool.lowestUtilizedPriceIndex

  if (remainingDebt.gt(totalPoolLiquidity)) {
    newLup = sortedBuckets[sortedBuckets.length - 1].price
    newLupIndex = sortedBuckets[sortedBuckets.length - 1].index
    remainingDebt = ZERO

    return [newLup, newLupIndex]
  }

  sortedBuckets.forEach(bucket => {
    if (remainingDebt.gt(bucket.quoteTokens)) {
      remainingDebt = remainingDebt.minus(bucket.quoteTokens)
    } else {
      if (remainingDebt.gt(0)) {
        newLup = bucket.price
        newLupIndex = bucket.index
        remainingDebt = ZERO
      }
    }
  })
  return [newLup, newLupIndex]
}

export function calculateNewLupWhenAdjusting(
  pool: AjnaPool,
  position: AjnaEarnPosition,
  simulation?: AjnaEarnPosition,
) {
  if (!simulation) {
    return {
      newLupPrice: pool.lowestUtilizedPrice,
      newLupIndex: pool.lowestUtilizedPriceIndex,
    }
  }

  let newLupPrice = ZERO
  let newLupIndex = ZERO

  const oldBucket = pool.buckets.find(bucket => bucket.price.eq(position.price))

  if (!oldBucket) {
    return {
      newLupPrice,
      newLupIndex,
    }
  }

  const poolBuckets = [...pool.buckets].filter(bucket => !bucket.index.eq(oldBucket.index))

  poolBuckets.push({
    ...oldBucket,
    quoteTokens: oldBucket.quoteTokens.minus(position.quoteTokenAmount),
  })

  const newBucketIndex = new BigNumber(
    ajnaBuckets.findIndex(bucket => new BigNumber(bucket).eq(simulation.price.shiftedBy(18))),
  )

  const existingBucketArrayIndex = poolBuckets.findIndex(bucket => bucket.index.eq(newBucketIndex))

  if (existingBucketArrayIndex !== -1) {
    poolBuckets[existingBucketArrayIndex].quoteTokens = poolBuckets[
      existingBucketArrayIndex
    ].quoteTokens.plus(simulation.quoteTokenAmount)
  } else {
    poolBuckets.push({
      price: simulation.price,
      index: newBucketIndex,
      quoteTokens: simulation.quoteTokenAmount,
      bucketLPs: ZERO,
      collateral: ZERO,
    })
  }

  const sortedBuckets = [...poolBuckets].sort((a, b) => a.index.minus(b.index).toNumber())

  let remainingDebt = pool.debt

  for (let i = 0; i < sortedBuckets.length; i++) {
    const bucket = sortedBuckets[i]

    if (remainingDebt.gt(bucket.quoteTokens)) {
      remainingDebt = remainingDebt.minus(bucket.quoteTokens)
    } else {
      newLupPrice = bucket.price
      newLupIndex = bucket.index
      break
    }
  }

  return {
    newLupPrice,
    newLupIndex,
  }
}

export function simulatePool(
  pool: AjnaPool,
  debtChange: BigNumber,
  positionDebt: BigNumber,
  positionCollateral: BigNumber,
): AjnaPool {
  const [newLup, newLupIndex] = calculateNewLup(pool, debtChange)

  return getSimulationPoolOutput(
    positionCollateral,
    positionDebt,
    debtChange,
    pool,
    newLup,
    newLupIndex,
  )
}

const resolveMaxLiquidityWithdraw = (availableToWithdraw: BigNumber, quoteTokenAmount: BigNumber) =>
  negativeToZero(availableToWithdraw.gte(quoteTokenAmount) ? quoteTokenAmount : availableToWithdraw)

export const calculateAjnaMaxLiquidityWithdraw = ({
  availableToWithdraw = ZERO,
  pool,
  position,
  poolCurrentLiquidity,
  simulation,
}: {
  availableToWithdraw?: BigNumber
  pool: AjnaPool
  poolCurrentLiquidity: BigNumber
  position: AjnaEarnPosition
  simulation?: AjnaEarnPosition
}) => {
  if (availableToWithdraw.gt(poolCurrentLiquidity)) {
    return position.quoteTokenAmount.gt(poolCurrentLiquidity)
      ? poolCurrentLiquidity
      : position.quoteTokenAmount
  }

  if (
    availableToWithdraw.gte(position.quoteTokenAmount) ||
    pool.lowestUtilizedPriceIndex.isZero() ||
    position.priceIndex?.gt(pool.lowestUtilizedPriceIndex)
  ) {
    return position.quoteTokenAmount
  }

  const { newLupIndex } = calculateNewLupWhenAdjusting(pool, position, simulation)

  if (newLupIndex.gt(pool.highestThresholdPriceIndex)) {
    return resolveMaxLiquidityWithdraw(availableToWithdraw, position.quoteTokenAmount)
  }

  const buckets = pool.buckets.filter(bucket => bucket.index.lte(pool.highestThresholdPriceIndex))

  const lupBucket = buckets.find(bucket => bucket.index.eq(pool.lowestUtilizedPriceIndex))
  const lupBucketIndex = buckets.findIndex(bucket => bucket.index.eq(pool.lowestUtilizedPriceIndex))

  if (!lupBucket) {
    return resolveMaxLiquidityWithdraw(availableToWithdraw, position.quoteTokenAmount)
  }

  const liquidityInLupBucket = getLiquidityInLupBucket(pool)

  if (!buckets[lupBucketIndex + 1]) {
    return resolveMaxLiquidityWithdraw(
      availableToWithdraw.plus(liquidityInLupBucket),
      position.quoteTokenAmount,
    )
  }

  return calculateAjnaMaxLiquidityWithdraw({
    availableToWithdraw: availableToWithdraw.plus(liquidityInLupBucket),
    pool: {
      ...pool,
      buckets: [
        ...buckets.filter(bucket => !bucket.index.eq(lupBucket.index)),
        { ...lupBucket, quoteTokens: lupBucket.quoteTokens.minus(liquidityInLupBucket) },
      ].sort((a, b) => a.index.minus(b.index).toNumber()),
      depositSize: pool.depositSize.minus(liquidityInLupBucket),
      lowestUtilizedPriceIndex: buckets[lupBucketIndex + 1].index,
      lowestUtilizedPrice: buckets[lupBucketIndex + 1].price,
    },
    poolCurrentLiquidity,
    position,
    simulation,
  })
}

// it's for simulation purposes only, for current value use t0Np from borrowerInfo
export function getNeutralPrice(
  pool: AjnaPool,
  debtChange: BigNumber,
  positionDebt: BigNumber,
  positionCollateral: BigNumber,
) {
  const { lowestUtilizedPrice } = simulatePool(pool, debtChange, positionDebt, positionCollateral)

  // calculate current pool debt
  const poolDebt = new BigNumber(pool.t0debt).times(pool.pendingInflator).plus(debtChange)

  const rate = pool.interestRate
  const noOfLoans = pool.loansCount.plus(pool.totalAuctionsInPool)

  // calculate the hypothetical MOMP and neutral price
  const mompDebt = noOfLoans.isZero() ? ONE : poolDebt.div(noOfLoans)
  // calculate new momp in this particular case
  const [momp] = calculateNewLup(pool, poolDebt.minus(mompDebt).times(-1))

  const thresholdPrice = positionCollateral.eq(ZERO) ? ZERO : positionDebt.div(positionCollateral)

  // neutralPrice = (1 + rate) * momp * thresholdPrice/lup
  return ONE.plus(rate).times(momp.times(thresholdPrice.div(lowestUtilizedPrice)))
}
