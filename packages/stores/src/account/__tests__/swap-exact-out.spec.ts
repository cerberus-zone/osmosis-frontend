/* eslint-disable */
import {
  chainId,
  deepContained,
  getEventFromTx,
  RootStore,
  waitAccountLoaded,
} from "../../__tests__/test-env";
import { Dec, Int, Coin, DecUtils, IntPretty } from "@keplr-wallet/unit";
import { Currency } from "@keplr-wallet/types";
import { WeightedPoolEstimates } from "@osmosis-labs/math";
import { ObservableQueryPool } from "src/queries";

// https://docs.osmosis.zone/developing/osmosis-core/modules/spec-gamm.html#swap-exact-amount-out

jest.setTimeout(60000);

describe("Test Osmosis Swap Exact Amount Out Tx", () => {
  const { accountStore, queriesStore } = new RootStore();
  let queryPool: ObservableQueryPool | undefined;

  beforeEach(async () => {
    const account = accountStore.getAccount(chainId);
    account.cosmos.broadcastMode = "block";
    await waitAccountLoaded(account);

    // And prepare the pool
    await new Promise<any>((resolve) => {
      account.osmosis.sendCreatePoolMsg(
        "0",
        [
          {
            weight: "200",
            token: {
              currency: {
                coinDenom: "OSMO",
                coinMinimalDenom: "uosmo",
                coinDecimals: 6,
              },
              amount: "100",
            },
          },
          {
            weight: "300",
            token: {
              currency: {
                coinDenom: "ION",
                coinMinimalDenom: "uion",
                coinDecimals: 6,
              },
              amount: "100",
            },
          },
        ],
        "",
        (tx) => {
          resolve(tx);
        }
      );
    });

    // refresh stores
    await queriesStore
      .get(chainId)
      .osmosis!.queryGammNumPools.waitFreshResponse();
    await queriesStore.get(chainId).osmosis!.queryGammPools.waitFreshResponse();

    // set poolId
    const numPools =
      queriesStore.get(chainId).osmosis!.queryGammNumPools.numPools;
    const poolId = numPools.toString();

    // get query pool
    queryPool = queriesStore
      .get(chainId)
      .osmosis!.queryGammPools.getPool(poolId);
  });

  test("should fail with unregistered pool asset", async () => {
    const account = accountStore.getAccount(chainId);

    await expect(
      account.osmosis.sendSwapExactAmountOutMsg(
        queryPool!.id,
        {
          coinDenom: "ION",
          coinMinimalDenom: "uion",
          coinDecimals: 6,
        },
        {
          currency: {
            coinDenom: "CAN",
            coinMinimalDenom: "ucan",
            coinDecimals: 6,
          },
          amount: "1",
        }
      )
    ).rejects.not.toBeNull();
  });

  test("should fail with unregistered pool asset (2)", async () => {
    const account = accountStore.getAccount(chainId);

    await expect(
      account.osmosis.sendSwapExactAmountOutMsg(
        queryPool!.id,
        {
          coinDenom: "Kwon",
          coinMinimalDenom: "ukwon",
          coinDecimals: 6,
        },
        {
          currency: {
            coinDenom: "Do",
            coinMinimalDenom: "udo",
            coinDecimals: 6,
          },
          amount: "1",
        }
      )
    ).rejects.not.toBeNull();
  });

  test("with no max slippage", async () => {
    const account = accountStore.getAccount(chainId);

    const tokenInCurrency = {
      coinDenom: "OSMO",
      coinMinimalDenom: "uosmo",
      coinDecimals: 6,
    };
    const tokenOut = {
      currency: {
        coinDenom: "ION",
        coinMinimalDenom: "uion",
        coinDecimals: 6,
      },
      amount: "1",
    };

    const estimated = await estimateSwapExactOut(
      queryPool!,
      tokenInCurrency,
      tokenOut
    );

    const tx = await new Promise<any>((resolve, reject) => {
      account.osmosis
        .sendSwapExactAmountOutMsg(
          queryPool!.id,
          tokenInCurrency,
          tokenOut,
          "0",
          "",
          (tx) => {
            resolve(tx);
          }
        )
        .catch(reject);
    });

    deepContained(
      {
        type: "message",
        attributes: [
          {
            key: "action",
            value: "/osmosis.gamm.v1beta1.MsgSwapExactAmountOut",
          },
          { key: "module", value: "gamm" },
          {
            key: "sender",
            value: account.bech32Address,
          },
        ],
      },
      getEventFromTx(tx, "message")
    );

    deepContained(
      {
        type: "transfer",
        attributes: [
          { key: "amount", value: "1000000uion" },
          {
            key: "amount",
            value:
              estimated.tokenIn
                .toDec()
                .mul(
                  DecUtils.getTenExponentNInPrecisionRange(
                    tokenInCurrency.coinDecimals
                  )
                )
                .truncate()
                .toString() + tokenInCurrency.coinMinimalDenom,
          },
        ],
      },
      getEventFromTx(tx, "transfer")
    );
  });

  test("with slippage", async () => {
    const account = accountStore.getAccount(chainId);

    const tokenInCurrency = {
      coinDenom: "OSMO",
      coinMinimalDenom: "uosmo",
      coinDecimals: 6,
    };
    const tokenOut = {
      currency: {
        coinDenom: "ION",
        coinMinimalDenom: "uion",
        coinDecimals: 6,
      },
      amount: "1",
    };

    const estimated = await estimateSwapExactOut(
      queryPool!,
      tokenInCurrency,
      tokenOut
    );

    const doubleSlippage = new IntPretty(
      estimated.slippage.toDec().mul(new Dec(2))
    )
      .locale(false)
      .maxDecimals(4)
      .trim(true);

    expect(doubleSlippage.toDec().gt(new Dec(0))).toBeTruthy();

    const tx = await new Promise<any>((resolve, reject) => {
      account.osmosis
        .sendSwapExactAmountOutMsg(
          queryPool!.id,
          tokenInCurrency,
          tokenOut,
          doubleSlippage.toString(),
          "",
          (tx) => {
            resolve(tx);
          }
        )
        .catch(reject);
    });

    deepContained(
      {
        type: "message",
        attributes: [
          {
            key: "action",
            value: "/osmosis.gamm.v1beta1.MsgSwapExactAmountOut",
          },
          { key: "module", value: "gamm" },
          {
            key: "sender",
            value: account.bech32Address,
          },
        ],
      },
      getEventFromTx(tx, "message")
    );

    deepContained(
      {
        type: "transfer",
        attributes: [
          { key: "amount", value: "1000000uion" },
          {
            key: "amount",
            value:
              estimated.tokenIn
                .toDec()
                .mul(
                  DecUtils.getTenExponentNInPrecisionRange(
                    tokenInCurrency.coinDecimals
                  )
                )
                .truncate()
                .toString() + tokenInCurrency.coinMinimalDenom,
          },
        ],
      },
      getEventFromTx(tx, "transfer")
    );
  });

  test("with exactly matched slippage and max slippage", async () => {
    const account = accountStore.getAccount(chainId);

    const tokenInCurrency = {
      coinDenom: "OSMO",
      coinMinimalDenom: "uosmo",
      coinDecimals: 6,
    };
    const tokenOut = {
      currency: {
        coinDenom: "ION",
        coinMinimalDenom: "uion",
        coinDecimals: 6,
      },
      amount: "1",
    };

    const estimated = await estimateSwapExactOut(
      queryPool!,
      tokenInCurrency,
      tokenOut
    );

    expect(estimated.slippage.toDec().gt(new Dec(0))).toBeTruthy();

    const tx = await new Promise<any>((resolve, reject) => {
      account.osmosis
        .sendSwapExactAmountOutMsg(
          queryPool!.id,
          tokenInCurrency,
          tokenOut,
          estimated.slippage.maxDecimals(18).toString(),
          "",
          (tx) => {
            resolve(tx);
          }
        )
        .catch(reject);
    });

    deepContained(
      {
        type: "message",
        attributes: [
          {
            key: "action",
            value: "/osmosis.gamm.v1beta1.MsgSwapExactAmountOut",
          },
          { key: "module", value: "gamm" },
          {
            key: "sender",
            value: account.bech32Address,
          },
        ],
      },
      getEventFromTx(tx, "message")
    );

    deepContained(
      {
        type: "transfer",
        attributes: [
          { key: "amount", value: "1000000uion" },
          {
            key: "amount",
            value:
              estimated.tokenIn
                .toDec()
                .mul(
                  DecUtils.getTenExponentNInPrecisionRange(
                    tokenInCurrency.coinDecimals
                  )
                )
                .truncate()
                .toString() + tokenInCurrency.coinMinimalDenom,
          },
        ],
      },
      getEventFromTx(tx, "transfer")
    );
  });

  test("should fail with more max slippage than calculated slippage", async () => {
    const account = accountStore.getAccount(chainId);

    const tokenInCurrency = {
      coinDenom: "OSMO",
      coinMinimalDenom: "uosmo",
      coinDecimals: 6,
    };
    const tokenOut = {
      currency: {
        coinDenom: "ION",
        coinMinimalDenom: "uion",
        coinDecimals: 6,
      },
      amount: "1",
    };

    const estimated = await estimateSwapExactOut(
      queryPool!,
      tokenInCurrency,
      tokenOut
    );

    const added = new IntPretty(estimated.slippage.toDec().sub(new Dec("0.01")))
      .locale(false)
      .maxDecimals(4);

    expect(estimated.slippage.toDec().gt(new Dec(0))).toBeTruthy();
    expect(added.toDec().gt(new Dec(0))).toBeTruthy();

    await expect(
      new Promise<any>((resolve, reject) => {
        account.osmosis
          .sendSwapExactAmountOutMsg(
            queryPool!.id,
            tokenInCurrency,
            tokenOut,
            added.toString(),
            "",
            (tx) => {
              resolve(tx);
            }
          )
          .catch(reject);
      })
    ).rejects.not.toBeNull();
  });
});

async function estimateSwapExactOut(
  queryPool: ObservableQueryPool,
  tokenInCurrency: Currency,
  tokenOut: { currency: Currency; amount: string }
) {
  await queryPool!.waitFreshResponse();
  const inPoolAsset = queryPool!.getPoolAsset(tokenInCurrency.coinMinimalDenom);
  const outPoolAsset = queryPool!.getPoolAsset(
    tokenOut.currency.coinMinimalDenom
  );
  return WeightedPoolEstimates.estimateSwapExactAmountOut(
    {
      inPoolAsset: {
        ...inPoolAsset.amount.currency,
        amount: new Int(inPoolAsset.amount.toCoin().amount),
        weight: inPoolAsset.weight.locale(false).toDec().truncate(),
      },
      outPoolAsset: {
        amount: new Int(outPoolAsset.amount.toCoin().amount),
        weight: outPoolAsset.weight.locale(false).toDec().truncate(),
      },
      swapFee: queryPool!.swapFee.toDec(),
    },
    new Coin(
      tokenOut.currency.coinMinimalDenom,
      new Dec(tokenOut.amount)
        .mul(
          DecUtils.getTenExponentNInPrecisionRange(
            tokenOut.currency.coinDecimals
          )
        )
        .truncate()
        .toString()
    ),
    tokenInCurrency
  );
}
