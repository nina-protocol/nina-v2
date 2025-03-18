import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NinaV2 } from "../target/types/nina_v2";
import { PublicKey, Keypair } from "@solana/web3.js";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

import {
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
} from "@solana/web3.js";

import {
  buildSignAndSendTransaction,
} from "./helpers/index";

const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

const program = anchor.workspace.NinaV2 as Program<NinaV2>;
const lightConnection = new anchor.web3.Connection('http://127.0.0.1:8899');

const provider = new anchor.AnchorProvider(lightConnection, anchor.Wallet.local(), anchor.AnchorProvider.defaultOptions());
anchor.setProvider(provider);
let royaltyTokenAccount: PublicKey;
const RELEASE_PRICE = 10000000;

// Request more compute units
const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
  units: 1000000,
});

const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 1,
});

describe("nina-v2", () => {

  const payer = Keypair.generate();
  const mint = Keypair.generate();
  const purchaser = Keypair.generate();
  let purchaserAta: PublicKey;
  const paymentMint = Keypair.generate();
  let payerAta: PublicKey;
  let ninaTreasuryAta: PublicKey;
  const ninaTreasury = Keypair.generate().publicKey;

  it("airdrop payer", async () => {
    console.log("before airdrop");
    const tx = await lightConnection
      .requestAirdrop(payer.publicKey, 10000000000)
      .catch((err) => console.log("err", err));
    if (!tx) {
      throw new Error("Transaction failed");
    }
    const latestBlockHash = await lightConnection.getLatestBlockhash();
    const payerConfirmed = await lightConnection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: tx,
    },
      'finalized',
    );
    console.log('airdrop payer confirmed', payerConfirmed)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const payerBalanceAfterAirdrop = await lightConnection.getBalance(
      payer.publicKey
    );
    console.log("payer Balance after airdrop", payerBalanceAfterAirdrop);
    await createMint(
      lightConnection,
      payer,
      payer.publicKey,
      null,
      7,
      paymentMint,
      {
        skipPreflight: true,
      },
      TOKEN_PROGRAM_ID
    );

    payerAta = await createAssociatedTokenAccount(
      lightConnection,
      payer,
      paymentMint.publicKey,
      payer.publicKey,
    )
    ninaTreasuryAta = await createAssociatedTokenAccount(
      lightConnection,
      payer,
      paymentMint.publicKey,
      ninaTreasury,
    )
    
    purchaserAta = await createAssociatedTokenAccount(
      lightConnection,
      payer,
      paymentMint.publicKey,
      purchaser.publicKey,
    )
    console.log('purchaserAta', purchaserAta)

    console.log(`ATA created ${payerAta.toBase58()}`)

    await mintTo(
      lightConnection,
      payer,
      paymentMint.publicKey,
      payerAta,
      payer.publicKey,
      RELEASE_PRICE * 10
    )

    console.log('mintTo')

    const purchaserTx = await lightConnection.requestAirdrop(
      purchaser.publicKey,
      10000000000
    );
    if (!purchaserTx) {
      throw new Error("purchaserTx Transaction failed");
    }
    const latestBlockHash2 = await lightConnection.getLatestBlockhash();
    const purchaserConfirmed = await lightConnection.confirmTransaction({
      blockhash: latestBlockHash2.blockhash,
      lastValidBlockHeight: latestBlockHash2.lastValidBlockHeight,
      signature: purchaserTx,
    },
      'finalized',
    );
    console.log('airdrop purchaser confirmed', purchaserConfirmed)
    const balanceAfterAirdrop = await lightConnection.getBalance(
      purchaser.publicKey
    );
    console.log("Balance after airdrop", balanceAfterAirdrop);

    await mintTo(
      lightConnection,
      payer,
      paymentMint.publicKey,
      purchaserAta,
      payer.publicKey,
      RELEASE_PRICE * 10
    )
  });

  it("Initialize A Release for publisher without paymentMint ATA", async () => {
    const balanceBefore = await lightConnection.getBalance(payer.publicKey);
    console.log("Balance before", balanceBefore);

    const { release, txid } = await buildAndSendReleaseInitV2Transaction(
      program,
      payer,
      lightConnection,
      paymentMint,
      mint,
      undefined,
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('release', release)
    const releaseAccount = await program.account.releaseV2.fetch(release);
    console.log("Release", releaseAccount);
    const balanceAfter = await lightConnection.getBalance(
      payer.publicKey,
      "confirmed"
    );
    console.log("Balance after", balanceAfter);

    if (txid) {
      const latestBlockHash = await lightConnection.getLatestBlockhash();
      await lightConnection.confirmTransaction(
        {
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: txid,
        },
        'finalized',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

  });

  it("Purchase a Release", async () => {
    const [release] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
        mint.publicKey.toBuffer(),
      ],
      program.programId
    );
    const [releaseSigner, releaseSignerBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [release.toBuffer()],
        program.programId
      );

    const ix = await program.methods
      .releasePurchase(
        new anchor.BN(RELEASE_PRICE),
        releaseSignerBump,
      )
      .accounts({
        payer: purchaser.publicKey,
        receiver: purchaser.publicKey,
        release,
        releaseSigner,
        mint: mint.publicKey,
        paymentMint: paymentMint.publicKey,
        paymentTokenAccount: purchaserAta,
        royaltyTokenAccount,
        receiverReleaseTokenAccount: associatedAddress({
          mint: mint.publicKey,
          owner: purchaser.publicKey,
          tokenProgramId: TOKEN_2022_PROGRAM_ID,
        }),
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  
    const txid = await buildSignAndSendTransaction(
      [modifyComputeUnits, addPriorityFee, ix],
      purchaser,
      lightConnection,
      []
    ).catch((err) => {
      console.log("Error", err);
    });
    if (txid) {
      const latestBlockHash = await lightConnection.getLatestBlockhash();
      await lightConnection.confirmTransaction(
        {
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: txid,
        },
        'confirmed',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("txid", txid);
  });
});



const buildAndSendReleaseInitV2Transaction = async (
  program: Program<NinaV2>,
  payer: Keypair,
  lightConnection: anchor.web3.Connection,
  paymentMint: Keypair,
  mint: Keypair,
  lookupTableAddress: PublicKey,
) => {
  const [release] = await anchor.web3.PublicKey.findProgramAddress(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
      mint.publicKey.toBuffer(),
    ],
    program.programId
  );
  const [releaseSigner, releaseSignerBump] =
    anchor.web3.PublicKey.findProgramAddressSync(
      [release.toBuffer()],
      program.programId
    );
  const associatedAddress = await getAssociatedTokenAddress(
    paymentMint.publicKey,
    releaseSigner,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_PROGRAM_ID
  );
  royaltyTokenAccount = associatedAddress;
  let royaltyTokenAccountExists;
  try {
    await getAccount(lightConnection, associatedAddress);
    royaltyTokenAccountExists = true;
  } catch (error) {
    royaltyTokenAccountExists = false;
  }

  let instructions = [];
  if (!royaltyTokenAccountExists) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        associatedAddress,
        releaseSigner,
        paymentMint.publicKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_PROGRAM_ID
      )
    );
  }

  const ix = await program.methods
    .releaseInitV2(
      `https://arweave.net/rb9wx261pn2nCbiHtoqR2vQtZ3MRQ3qcyZeSSCE0Rm4`,
      "Nina Test",
      "NINA",
      new anchor.BN(100),
      new anchor.BN(RELEASE_PRICE),
      releaseSignerBump
    )
    .accountsStrict({
      payer: payer.publicKey,
      authority: payer.publicKey,
      release,
      mint: mint.publicKey,
      releaseSigner,
      paymentMint: paymentMint.publicKey,
      royaltyTokenAccount: associatedAddress,
      systemProgram: anchor.web3.SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
  let lookupTableAccount;
  if (lookupTableAddress) {
    lookupTableAccount = (
      await lightConnection.getAddressLookupTable(lookupTableAddress)
    ).value;
  }

  const { blockhash } = await lightConnection.getLatestBlockhash();

    const messageV0 = new anchor.web3.TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [modifyComputeUnits, addPriorityFee, ...instructions, ix],
    }).compileToV0Message(lookupTableAccount ? [lookupTableAccount] : [])
    const tx = new anchor.web3.VersionedTransaction(messageV0)
    tx.sign([payer, mint])
    const txid = await lightConnection.sendRawTransaction(tx.serialize())
  console.log("Your transaction signature", txid);

  return { release, txid };
};

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
