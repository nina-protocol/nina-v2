import "dotenv/config.js";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NinaV2 } from "../../target/types/nina_v2";
import {
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getAccount,
  getTokenMetadata,
} from "@solana/spl-token";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import Knex from "knex";
import { buildSignAndSendTransaction } from "../../tests/helpers/index";
import Nina from "@nina-protocol/js-sdk-dev"
import { appendFile } from 'fs/promises';

const MAX_U64 = new anchor.BN('ffffffffffffffff', 16);

const knexConfig = {
  client: 'postgresql',
  connection: {
    host:     process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DATABASE,
    user:     process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  },
}
const db = Knex(knexConfig)
let ninaV1ProgramId: anchor.web3.PublicKey;
let ninaV2ProgramId: anchor.web3.PublicKey;

export const initHelper = async (programId: anchor.web3.PublicKey, programIdV2: anchor.web3.PublicKey) => {
  validateEnvironment();
  ninaV1ProgramId = programId;
  ninaV2ProgramId = programIdV2;
  await Nina.init({
    endpoint: process.env.NINA_API_ENDPOINT,
    rpcEndpoint: process.env.NINA_RPC_ENDPOINT,
    programId: programId,
    programIdV2: programIdV2,
    cluster: process.env.NINA_SOLANA_CLUSTER,
  });
}

export function associatedAddress({
  mint,
  owner,
  tokenProgramId = TOKEN_PROGRAM_ID,
}: {
  mint: PublicKey;
  owner: PublicKey;
  tokenProgramId?: PublicKey;
}): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_PROGRAM_ID
  )[0];
}

const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
  units: 10000000,
});

const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 1,
});

export const migrateReleaseFromV1ToV2 = async (release: any, program: Program<NinaV2>, provider: anchor.AnchorProvider, connection: anchor.web3.Connection) => {
  let txid: string;
  let migrated: boolean = false;
  try {
    console.log('release', release);

    const authorityPublicKey = new anchor.web3.PublicKey(release.publisher);
    const v1ReleasePublicKey = new anchor.web3.PublicKey(release.publicKey);
    const releaseMintPublicKey = new anchor.web3.PublicKey(release.mint);
    const releaseSignerPublicKey = new anchor.web3.PublicKey(release.accountData.release.releaseSigner);
    const v1PaymentMintPublicKey = new anchor.web3.PublicKey(release.accountData.release.paymentMint);
    const royaltyTokenAccountPublicKey = new anchor.web3.PublicKey(release.accountData.release.royaltyTokenAccount);
    let paymentMintPublicKey = new anchor.web3.PublicKey(release.accountData.release.paymentMint);
    
    if (isDevnet()) {
      paymentMintPublicKey = new anchor.web3.PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    }

    const v2AuthorityTokenAccount = associatedAddress({
      mint: paymentMintPublicKey,
      owner: authorityPublicKey,
    });

    const [v2Release] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
        releaseMintPublicKey.toBuffer(),
      ],
      program.programId
    );
    const [v2ReleaseSigner] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [v2Release.toBuffer()],
        program.programId
      );
    const metadataProgram = new anchor.web3.PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
    const [metadata] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('metadata'), metadataProgram.toBuffer(), releaseMintPublicKey.toBuffer()],
      metadataProgram,
    );

    const remainingAccounts = release.accountData.release.revenueShareRecipients
      .filter(
        (r) =>
          r.recipientAuthority !== anchor.web3.PublicKey.default.toString() &&
          r.recipientTokenAccount !== anchor.web3.PublicKey.default.toString() &&
          r.owed > 0
      )
      .map((r) => ({
        pubkey: new anchor.web3.PublicKey(r.recipientTokenAccount),
        isSigner: false,
        isWritable: true,
      }));

      console.log({
        payer: provider.wallet.publicKey,
        authority: authorityPublicKey,
        release: v1ReleasePublicKey,
        releaseMint: releaseMintPublicKey,
        releaseSigner: releaseSignerPublicKey,
        paymentMint: paymentMintPublicKey,
        v1PaymentMint: v1PaymentMintPublicKey,
        royaltyTokenAccount: royaltyTokenAccountPublicKey,
        v2Release,
        v2ReleaseSigner,
        v2AuthorityTokenAccount,
        metadata,
        metadataProgram,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        v1Program: ninaV1ProgramId,
      })
    const ix = await program.methods
      .releaseMigrateV1ToV2()
      .accountsStrict({
        payer: provider.wallet.publicKey,
        authority: authorityPublicKey,
        release: v1ReleasePublicKey,
        releaseMint: releaseMintPublicKey,
        releaseSigner: releaseSignerPublicKey,
        paymentMint: paymentMintPublicKey,
        v1PaymentMint: v1PaymentMintPublicKey,
        royaltyTokenAccount: royaltyTokenAccountPublicKey,
        v2Release,
        v2ReleaseSigner,
        v2AuthorityTokenAccount,
        metadata,
        metadataProgram,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        v1Program: ninaV1ProgramId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
    try {
      txid = await buildSignAndSendTransaction(
        [modifyComputeUnits, addPriorityFee, ix],
        provider.wallet.payer,
        connection,
        [],
      );
    } catch (error) {
      console.log('error', error);
      throw new Error(error);
    }
    
    let tx;
    if (txid) {
      const latestBlockHash = await connection.getLatestBlockhash();
      tx = await connection.confirmTransaction(
        {
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: txid,
        },
        'finalized',
      );
      console.log('tx', tx);
    }

    console.log('txid', txid);
    if (tx.value.err) {
      throw new Error(tx.value.err);
    }

    migrated = true;

    const updatedReleaseFields = {
      programId: program.programId.toString(),
      solanaAddress: v2Release.toString(),
      migratedFromV1: true,
    } as any;

    // just for testing
    if (isDevnet()) {
      updatedReleaseFields.paymentMint = paymentMintPublicKey.toString();
    }
    await db('releases').where('publicKey', v1ReleasePublicKey.toString()).update(updatedReleaseFields);
    return {
      txid,
      v2Release,
      v1ReleasePublicKey,
      authorityPublicKey,
      releaseMintPublicKey,
      releaseSignerPublicKey,
      paymentMintPublicKey,
      royaltyTokenAccountPublicKey,
      v2AuthorityTokenAccount,
      v2ReleaseSigner,
      metadata,
    }
  } catch (error) {
    await writeMigrationFailureLog(release.publicKey, false, error.message, migrated, txid);
    throw new Error(error);
  }
}

export const getReleaseFromV1ByPublicKey = async (publicKey: string) => {
  try {
    const { release } = await Nina.Release.fetch(publicKey, {}, true) as any;
    console.log('release', release);
    if (release.programId !== ninaV1ProgramId.toString()) {
      throw new Error('Release is not from V1');
    }
    if (Object.keys(release.accountData.release).length === 0) {
      throw new Error('Release is not valid - no account data');
    }
    return release;
  } catch (error) {
    console.log('error', error);
    throw new Error(error);
  }
}

export const getReleasesFromV1 = async (total: number = 100000, program: Program<NinaV2>, offset: number = 0, attempts: number = 0) => {
  console.log('ninaV1ProgramId', ninaV1ProgramId.toString());
  console.log('program.programId', program.programId.toString());
  let allReleases = []
  try {
    const releases = await db('releases').where('programId', ninaV1ProgramId.toString()).where('migratedFromV1', false).limit(total).offset(offset);
    console.log('releases', releases);
    for await (const r of releases) {
      const { release: releaseWithAccountData } = await Nina.Release.fetch(r.publicKey, {}, true) as any;
      if (Object.keys(releaseWithAccountData.accountData.release).length > 0) {
        allReleases.push(releaseWithAccountData);
      }
    }
    console.log('allReleases', allReleases.length);
    if (allReleases.length < total) {
      console.log('not enough releases found, trying again - attempts:', attempts + 1);
      return await getReleasesFromV1(total - allReleases.length, program, (offset * attempts + 1) + total, attempts + 1);
    }
  } catch (error) {
    console.log('broke because of bad release');
    console.log('error', error);
  }
  return allReleases;
}


const isDevnet = () => {
  return process.env.NINA_SOLANA_CLUSTER === 'devnet' &&
  process.env.NINA_API_ENDPOINT === 'http://ec2-18-224-24-103.us-east-2.compute.amazonaws.com:3001/v1' &&
  process.env.NINA_RPC_ENDPOINT.includes('https://nina.devnet.rpcpool.com') &&
  process.env.NINA_V1_PROGRAM_ID === '77BKtqWTbTRxj5eZPuFbeXjx3qz4TTHoXRnpCejYWiQH' &&
  process.env.POSTGRES_DATABASE === 'api-public-dev';
}

const isMainnet = () => {
  return process.env.NINA_SOLANA_CLUSTER === 'mainnet' &&
  process.env.NINA_API_ENDPOINT === 'https://services.ninaprotocol.com/v1' &&
  process.env.NINA_RPC_ENDPOINT.includes('https://nina.rpcpool.com') &&
  process.env.NINA_V1_PROGRAM_ID === 'ninaN2tm9vUkxoanvGcNApEeWiidLMM2TdBX8HoJuL4' &&
  process.env.POSTGRES_DATABASE === 'api-public';
}

export const validateEnvironment = () => {
  if (!isDevnet() && !isMainnet()) {
    throw new Error(`Invalid environment: \nNINA_SOLANA_CLUSTER: ${process.env.NINA_SOLANA_CLUSTER} \nNINA_API_ENDPOINT: ${process.env.NINA_API_ENDPOINT} \nNINA_V1_PROGRAM_ID: ${process.env.NINA_V1_PROGRAM_ID} \nNINA_V2_PROGRAM_ID: ${process.env.NINA_V2_PROGRAM_ID} \nPOSTGRES_DATABASE: ${process.env.POSTGRES_DATABASE}`);
  }
}

export const validateMigration = async (
  releaseV1,
  txid: string,
  program: Program<NinaV2>,
  connection: anchor.web3.Connection,
) => {
  try {
    const releaseV2 = await db('releases').where('publicKey', releaseV1.publicKey).first();
    if (!releaseV2) {
      throw new Error('Release is not valid - v2 release not found in database');
    }
    if (releaseV2.programId !== ninaV2ProgramId.toString()) {
      throw new Error('Release is not from V2');
    }

    if (releaseV2.publicKey !== releaseV1.publicKey) {
      throw new Error('Release is not valid - public key mismatch');
    }

    if (releaseV2.solanaAddress === releaseV1.publicKey) {
      throw new Error('Release is not valid - solana address mismatch');
    }

    if (releaseV2.migratedFromV1 !== true) {
      throw new Error('Release is not valid - not migrated from V1');
    }

    console.log('isDevnet', isDevnet());
    console.log('isMainnet', isMainnet());
    if (isDevnet()) {
      console.log('releaseV2.paymentMint', releaseV2.paymentMint.toString());
      if (releaseV2.paymentMint.toString() !== '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU') {
        console.log('isDevnet - payment mint mismatch');
        throw new Error('Release is not valid - payment mint mismatch');
      }
    }

    if (isMainnet()) {
      if (releaseV2.paymentMint.toString() !== releaseV1.paymentMint) {
        console.log('isMainnet - payment mint mismatch');
        throw new Error('Release is not valid - payment mint mismatch');
      }
    }

    const releaseV2Account = await program.account.releaseV2.fetch(new anchor.web3.PublicKey(releaseV2.solanaAddress));
    if (releaseV2Account.authority.toString() !== releaseV1.publisher) {
      throw new Error('Release is not valid - authority mismatch');
    }
    console.log('releaseV2Account', releaseV2Account);
    console.log('releaseV1.accountData.release', releaseV1.accountData.release);
    if (releaseV2Account.releaseSigner.toString() === releaseV1.accountData.release.releaseSigner) {
      throw new Error('Release is not valid - release signer mismatch');
    }

    const expectedTotalSupply = releaseV1.accountData.release.totalSupply === -1 ? Number(MAX_U64) : releaseV1.accountData.release.totalSupply;
    if (Number(releaseV2Account.totalSupply) !== expectedTotalSupply) {
      throw new Error('Release is not valid - total supply mismatch');
    }

    if (Number(releaseV2Account.price) !== Number(releaseV1.accountData.release.price)) {
      throw new Error('Release is not valid - price mismatch');
    }

    const v1ReleaseAccount = await connection.getAccountInfo(new anchor.web3.PublicKey(releaseV1.publicKey))
    if (v1ReleaseAccount) {
      throw new Error('Release is not valid - v1 release account still exists');
    }

    const v1RoyaltyTokenAccount = await connection.getAccountInfo(new anchor.web3.PublicKey(releaseV1.accountData.release.royaltyTokenAccount))
    if (v1RoyaltyTokenAccount) {
      throw new Error('Release is not valid - v1 royalty token account still exists');
    }

    if (releaseV1.accountData.release.saleTotal > releaseV1.accountData.release.totalCollected) {
      const revenueShareRecipients = releaseV1.accountData.release.revenueShareRecipients.filter(r => r.owed > 0);
      if (revenueShareRecipients.length === 0) {
        throw new Error('Release is not valid - no revenue share recipients found when remainging balance exists');
      }

      const tokenTransfers = await parseTokenTransfersByDiff(connection, txid);
      console.log('tokenTransfers', tokenTransfers);
      if (tokenTransfers.length === 0) {
        throw new Error('Release is not valid - no token transfers found when remainging balance exists');
      }

      for (const tokenTransfer of tokenTransfers) {
        if (tokenTransfer.mint !== releaseV1.accountData.release.paymentMint) {
          throw new Error('Release is not valid - token transfer mint mismatch');
        }
        if (tokenTransfer.from !== releaseV1.accountData.release.releaseSigner) {
          throw new Error('Release is not valid - token transfer from mismatch');
        }
        const revenueShareRecipient = revenueShareRecipients.find(r => r.recipientTokenAccount === tokenTransfer.to);
        if (!revenueShareRecipient) {
          throw new Error('Release is not valid - owed revenue share recipient not found in token transfers');
        }
        if (Number(tokenTransfer.amount) !== Number(revenueShareRecipient.owed)) {
          throw new Error('Release is not valid - token transfer amount mismatch to revenue share recipient');
        }
      }
    }
    await writeMigrationSuccessLog(releaseV1.publicKey, releaseV2.publicKey, txid);
    return true;
  } catch (error) {
    console.log('Migration unsuccessful - validation failed: ',releaseV1.publicKey, error);
    await writeMigrationFailureLog(releaseV1.publicKey, false, error.message, true);
    throw new Error(error);
  }
}

export const writeMigrationFailureLog = async (
  v1ReleasePublicKey: string,
  isValid: boolean,
  error: string,
  migrated: boolean = false,
  txid?: string
) => {
  const log = {
    date: new Date().toISOString(),
    v1ReleasePublicKey,
    isValid,
    error,
    migrated,
    txid,
  }
  await appendFile(`./scripts/migration/logs/migration-failure-${process.env.NINA_SOLANA_CLUSTER}.log`, JSON.stringify(log) + '\n');
}

export const writeMigrationSuccessLog = async (
  v1ReleasePublicKey: string,
  v2ReleasePublicKey: string,
  txid: string,
) => {
  const log = {
    date: new Date().toISOString(),
    v2ReleasePublicKey,
    v1ReleasePublicKey,
    txid,
  }
  await appendFile(`./scripts/migration/logs/migration-success-${process.env.NINA_SOLANA_CLUSTER}.log`, JSON.stringify(log) + '\n');
}

/**
 * Parse SPL token transfers from a confirmed/finalized transaction
 * by diffing pre/post token balances.
 */
export type ParsedTokenTransfer = {
  mint: string;                 // mint address
  tokenProgram: string;         // token program id (Token or Token-2022)
  decimals: number;
  from?: string;                // owner sending (omitted for mint)
  to?: string;                  // owner receiving (omitted for burn)
  // amounts in base units
  amountRaw: bigint;            // absolute amount in smallest units
  // UI amounts
  amount: string;               // decimal string using 'decimals'
  kind: "transfer" | "mint" | "burn";
};

type BalanceKey = string; // owner|mint|programId

function keyOf(owner: string, mint: string, programId: string): BalanceKey {
  return `${owner}|${mint}|${programId}`;
}

function formatUi(amountRaw: bigint, decimals: number): string {
  const s = amountRaw.toString();
  if (decimals === 0) return s;
  const pad = decimals - Math.max(0, s.length - 1);
  const i = Math.max(0, s.length - decimals);
  const intPart = i > 0 ? s.slice(0, i) : "0";
  let frac = i > 0 ? s.slice(i) : s.padStart(decimals, "0");
  // trim trailing zeros but keep at least one 0 if there is any fractional part
  frac = frac.replace(/0+$/, "");
  return frac.length ? `${intPart}.${frac}` : intPart;
}

export async function parseTokenTransfersByDiff(
  connection: anchor.web3.Connection,
  signature: string
): Promise<ParsedTokenTransfer[]> {
  const tx: anchor.web3.VersionedTransactionResponse | null = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0, // or omit to allow v0
    commitment: "confirmed"
  });

  if (!tx || !tx.meta) return [];

  const pre = tx.meta.preTokenBalances ?? [];
  const post = tx.meta.postTokenBalances ?? [];

  // Build maps: key=(owner|mint|programId) -> {decimals, programId, deltaRaw}
  type Entry = { decimals: number; programId: string; delta: bigint; mint: string; owner: string };
  const map = new Map<BalanceKey, Entry>();

  const add = (owner: string, mint: string, programId: string, raw: bigint, decimals: number) => {
    const k = keyOf(owner, mint, programId);
    const e = map.get(k) ?? { decimals, programId, delta: 0n, mint, owner };
    e.delta += raw;
    e.decimals = decimals; // last wins (should be same)
    map.set(k, e);
  };

  // helper to parse uiTokenAmount to bigint raw
  const toRaw = (uiAmountString: string, decimals: number): bigint => {
    if (!uiAmountString) return 0n;
    const [i, f = ""] = uiAmountString.split(".");
    const frac = f.padEnd(decimals, "0").slice(0, decimals);
    return BigInt((i || "0") + frac);
  };

  // Start with pre as negative
  for (const b of pre) {
    // tokenBalances item may have .owner; if missing, fall back to accountIndex -> accountKeys owner isn’t exposed here,
    // but modern RPC includes owner. We assume owner exists (1.17+).
    const owner = b.owner!;
    const mint = b.mint;
    const programId = b.programId ?? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"; // default Token
    const decimals = b.uiTokenAmount.decimals;
    const raw = toRaw(b.uiTokenAmount.uiAmountString ?? "0", decimals);
    add(owner, mint, programId, -raw, decimals);
  }
  // Add post as positive
  for (const b of post) {
    const owner = b.owner!;
    const mint = b.mint;
    const programId = b.programId ?? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const decimals = b.uiTokenAmount.decimals;
    const raw = toRaw(b.uiTokenAmount.uiAmountString ?? "0", decimals);
    add(owner, mint, programId, raw, decimals);
  }

  // Group by (mint, programId) into sends/receives and pair them
  const byMint = new Map<string, Entry[]>();
  for (const e of map.values()) {
    const key = `${e.mint}|${e.programId}`;
    const arr = byMint.get(key) ?? [];
    if (e.delta !== 0n) arr.push(e);
    byMint.set(key, arr);
  }

  const results: ParsedTokenTransfer[] = [];

  for (const [, entries] of byMint) {
    const positives = entries.filter(e => e.delta > 0n).sort((a,b)=> Number(b.delta - a.delta)); // largest first
    const negatives = entries.filter(e => e.delta < 0n).sort((a,b)=> Number(a.delta - b.delta)); // most negative first
    const decimals = entries[0]?.decimals ?? 0;
    const mint = entries[0]?.mint!;
    const tokenProgram = entries[0]?.programId!;

    // Greedy pair amounts
    let iPos = 0, iNeg = 0;
    while (iPos < positives.length && iNeg < negatives.length) {
      const recv = positives[iPos];
      const send = negatives[iNeg];
      const take = recv.delta < -send.delta ? recv.delta : -send.delta; // min
      results.push({
        kind: "transfer",
        mint,
        tokenProgram,
        decimals,
        from: send.owner,
        to: recv.owner,
        amountRaw: take,
        amount: formatUi(take, decimals),
      });
      // reduce remainders
      recv.delta -= take;
      send.delta += take;
      if (recv.delta === 0n) iPos++;
      if (send.delta === 0n) iNeg++;
    }

    // Leftover positives => mints
    for (; iPos < positives.length; iPos++) {
      const r = positives[iPos];
      if (r.delta === 0n) continue;
      results.push({
        kind: "mint",
        mint,
        tokenProgram,
        decimals,
        to: r.owner,
        amountRaw: r.delta,
        amount: formatUi(r.delta, decimals),
      });
    }
    // Leftover negatives => burns
    for (; iNeg < negatives.length; iNeg++) {
      const s = negatives[iNeg];
      if (s.delta === 0n) continue;
      const abs = -s.delta;
      results.push({
        kind: "burn",
        mint,
        tokenProgram,
        decimals,
        from: s.owner,
        amountRaw: abs,
        amount: formatUi(abs, decimals),
      });
    }
  }

  return results;
}