import { randomUUID } from "node:crypto";
import { db, transaction } from "./db";
import { HttpError } from "./http";

export async function wallet(userId: string) {
  await db.query(
    "INSERT INTO wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [userId],
  );
  const { rows } = await db.query(
    "SELECT balance_micros,reserved_micros FROM wallets WHERE user_id=$1",
    [userId],
  );
  return {
    balanceUsd: Number(rows[0].balance_micros) / 1e6,
    reservedUsd: Number(rows[0].reserved_micros) / 1e6,
    availableUsd:
      (Number(rows[0].balance_micros) - Number(rows[0].reserved_micros)) / 1e6,
  };
}
export async function credit(
  userId: string,
  amount: number,
  reference: string,
) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1e12)
    throw new Error("Invalid credit amount");
  return transaction(async (c) => {
    await c.query(
      "INSERT INTO wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [userId],
    );
    const inserted = await c.query(
      "INSERT INTO ledger(id,user_id,amount_micros,kind,reference) VALUES($1,$2,$3,'credit',$4) ON CONFLICT(reference) DO NOTHING RETURNING id",
      [randomUUID(), userId, amount, reference],
    );
    if (inserted.rowCount)
      await c.query(
        "UPDATE wallets SET balance_micros=balance_micros+$2 WHERE user_id=$1",
        [userId, amount],
      );
    return Boolean(inserted.rowCount);
  });
}
export async function reserve(
  userId: string,
  key: string,
  fingerprint: string,
  amount: number,
) {
  return transaction(async (c) => {
    await c.query(
      "INSERT INTO wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [userId],
    );
    // Serializes concurrent spending and duplicate request keys for this account.
    const wallet = (
      await c.query("SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE", [
        userId,
      ])
    ).rows[0];
    const existing = (
      await c.query(
        "SELECT * FROM requests WHERE user_id=$1 AND idempotency_key=$2",
        [userId, key],
      )
    ).rows[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new HttpError(
          409,
          "Idempotency key was used with a different request",
        );
      if (existing.status === "running")
        throw new HttpError(
          409,
          existing.needs_reconciliation
            ? "Request needs operator reconciliation; do not repeat the action"
            : "Request is already running; retry this key later",
          existing.needs_reconciliation
            ? "needs_reconciliation"
            : "in_progress",
        );
      if (
        !existing.response ||
        new Date(existing.finished_at).getTime() < Date.now() - 86400000
      )
        throw new HttpError(
          410,
          "Cached response expired; this request will not be executed again",
        );
      return {
        id: existing.id as string,
        replay: {
          body: existing.response,
          status: existing.response_status as number,
        },
      };
    }
    if (Number(wallet.balance_micros) - Number(wallet.reserved_micros) < amount)
      throw new HttpError(
        402,
        "Insufficient prepaid credits",
        "insufficient_credits",
      );
    const id = randomUUID();
    await c.query(
      "UPDATE wallets SET reserved_micros=reserved_micros+$2 WHERE user_id=$1",
      [userId, amount],
    );
    await c.query(
      "INSERT INTO requests(id,user_id,idempotency_key,fingerprint,status,reserved_micros) VALUES($1,$2,$3,$4,'running',$5)",
      [id, userId, key, fingerprint, amount],
    );
    return { id, replay: undefined };
  });
}
export async function settle(
  id: string,
  amount: number,
  body: unknown,
  status: number,
) {
  await transaction(async (c) => {
    const request = (
      await c.query("SELECT * FROM requests WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!request || request.status !== "running") return;
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > Number(request.reserved_micros)
    )
      throw new Error("Settlement exceeds reservation");
    await c.query(
      "UPDATE wallets SET balance_micros=balance_micros-$2,reserved_micros=reserved_micros-$3 WHERE user_id=$1",
      [request.user_id, amount, request.reserved_micros],
    );
    if (amount)
      await c.query(
        "INSERT INTO ledger(id,user_id,amount_micros,kind,reference) VALUES($1,$2,$3,'call',$4)",
        [randomUUID(), request.user_id, -amount, `call:${id}`],
      );
    await c.query(
      "UPDATE requests SET needs_reconciliation=false,status=$2,charged_micros=$3,response=$4,response_status=$5,finished_at=now() WHERE id=$1",
      [
        id,
        status < 400 ? "completed" : "failed",
        amount,
        JSON.stringify(body),
        status,
      ],
    );
  });
}

/** Never silently refund an action whose dispatch may have reached the maker. */
export async function interruptRequest(id: string) {
  const { rows } = await db.query(
    "SELECT upstream_started FROM requests WHERE id=$1 AND status='running'",
    [id],
  );
  if (!rows.length) return;
  if (rows[0].upstream_started) {
    await db.query(
      "UPDATE requests SET needs_reconciliation=true WHERE id=$1 AND status='running'",
      [id],
    );
  } else {
    await settle(
      id,
      0,
      {
        error: {
          code: "interrupted_before_dispatch",
          message:
            "Request interrupted before dispatch; no credits were charged",
        },
      },
      503,
    );
  }
}
