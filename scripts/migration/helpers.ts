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
    await writeMigrationLog(release.publicKey, false, error.message, migrated, txid);
    throw new Error(error);
  }
}

export const getReleaseFromV1ByPublicKey = async (publicKey: string) => {
  try {
    const { release } = await Nina.Release.fetch(publicKey, {}, true);
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

export const getReleasesFromV1 = async (limit: number = 100, offset: number = 0, total: number = 0, program: Program<NinaV2>) => {
  console.log('ninaV1ProgramId', ninaV1ProgramId.toString());
  console.log('program.programId', program.programId.toString());
  let allReleases = []
  try {
    while (allReleases.length <= total) {
      const releaseAccounts = await Nina.Release.fetchAll({
        limit,
        offset: offset,
        sort: 'asc'
      }, true);
      releaseAccounts.releases.forEach(release => {
        if (release.programId === ninaV1ProgramId.toString() && Object.keys(release.accountData.release).length > 0) {
          allReleases.push(release);
        }
      });
      if (limit > 1 && total === 0) {
        total = releaseAccounts.total;
      }
      if (allReleases.length >= total) {
        break;
      }
      offset += 100;
      console.log('allReleases', allReleases.length);
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
    throw new Error(`Invalid environment: \NINA_SOLANA_CLUSTER: ${process.env.NINA_SOLANA_CLUSTER} \nNINA_API_ENDPOINT: ${process.env.NINA_API_ENDPOINT} \nNINA_V1_PROGRAM_ID: ${process.env.NINA_V1_PROGRAM_ID} \nNINA_V2_PROGRAM_ID: ${process.env.NINA_V2_PROGRAM_ID} \nPOSTGRES_DATABASE: ${process.env.POSTGRES_DATABASE}`);
  }
}

export const validateMigration = async (
  releaseV1,
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

    return true;
  } catch (error) {
    console.log('Migration unsuccessful - validation failed: ',releaseV1.publicKey, error);
    await writeMigrationLog(releaseV1.publicKey, false, error.message, true);
    throw new Error(error);
  }
}

export const writeMigrationLog = async (
  v1ReleasePublicKey: string,
  isValid: boolean,
  error: string,
  migrated: boolean = false,
  txid?: string
) => {

  const log = {
    v1ReleasePublicKey,
    isValid,
    error,
    migrated,
    txid,
  }
  await appendFile(`./scripts/migration/logs/migration-${process.env.NINA_SOLANA_CLUSTER}.log`, JSON.stringify(log) + '\n');
}