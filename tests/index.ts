import "dotenv/config.js";
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
  getTokenMetadata,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
} from "@solana/web3.js";
import Knex from "knex";
import {
  buildSignAndSendTransaction,
} from "./helpers/index";
import { expect } from "chai";
import Nina from "@nina-protocol/js-sdk-dev"

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
  
const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
const CRS_FEE = 10_000_000;
const MAX_U64 = new anchor.BN('ffffffffffffffff', 16);

const lightConnection = new anchor.web3.Connection('http://localhost:8899');
const provider = new anchor.AnchorProvider(lightConnection, anchor.Wallet.local(), anchor.AnchorProvider.defaultOptions());
anchor.setProvider(provider);
const program = anchor.workspace.NinaV2 as Program<NinaV2>;

const ninaV1ProgramId = new anchor.web3.PublicKey("77BKtqWTbTRxj5eZPuFbeXjx3qz4TTHoXRnpCejYWiQH");


let royaltyTokenAccount: PublicKey;
const RELEASE_PRICE = 10000000;

// Request more compute units
const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
  units: 10000000,
});

const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 1,
});

const artist = Keypair.generate();
const payer = Keypair.generate();
const mint = Keypair.generate();
const mint2 = Keypair.generate();
const mint3 = Keypair.generate();
const mint4 = Keypair.generate();
const purchaser = Keypair.generate();
const paymentMint = Keypair.generate();
const ninaTreasury = Keypair.generate().publicKey;
let purchaserAta: PublicKey;
let payerAta: PublicKey;
let ninaTreasuryAta: PublicKey;
let crsAccount = new PublicKey("crsNECAdnFS1dUM136E13AuARA5XPCBqAy2gTzyp7dv");
let crsTokenAccount: PublicKey;

describe("nina-v2", () => {

  it("setup accounts", async () => {
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

    const artistTx = await lightConnection.requestAirdrop(
      artist.publicKey,
      10000000000
    );
    if (!artistTx) {
      throw new Error("artistTx Transaction failed");
    }
    const latestBlockHashArtist = await lightConnection.getLatestBlockhash();
    const artistConfirmed = await lightConnection.confirmTransaction({
      blockhash: latestBlockHashArtist.blockhash,
      lastValidBlockHeight: latestBlockHashArtist.lastValidBlockHeight,
      signature: artistTx,
    },
      'finalized',
    );
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

    crsTokenAccount = await createAssociatedTokenAccount(
      lightConnection,
      payer,
      paymentMint.publicKey,
      crsAccount,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_PROGRAM_ID
    )

    purchaserAta = await createAssociatedTokenAccount(
      lightConnection,
      payer,
      paymentMint.publicKey,
      purchaser.publicKey,
    )

    await mintTo(
      lightConnection,
      payer,
      paymentMint.publicKey,
      payerAta,
      payer.publicKey,
      RELEASE_PRICE * 100
    )

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
      RELEASE_PRICE * 100
    )
  });

  // it("Initialize A Release for publisher without paymentMint ATA", async () => {
  //   const balanceBefore = await lightConnection.getBalance(payer.publicKey);
  //   console.log("Balance before", balanceBefore);
  //   console.log('payer', payer.publicKey)
  //   const { release, txid } = await buildAndSendReleaseInitV2Transaction(
  //     program,
  //     payer,
  //     artist,
  //     lightConnection,
  //     paymentMint,
  //     mint,
  //     undefined,
  //   );

  //   await new Promise((resolve) => setTimeout(resolve, 1000));
  //   console.log('release', release)
  //   const releaseAccount = await program.account.releaseV2.fetch(release);
  //   console.log("Release", releaseAccount);
  //   const balanceAfter = await lightConnection.getBalance(
  //     payer.publicKey,
  //     "confirmed"
  //   );
  //   console.log("Balance after", balanceAfter);

  //   if (txid) {
  //     const latestBlockHash = await lightConnection.getLatestBlockhash();
  //     await lightConnection.confirmTransaction(
  //       {
  //         blockhash: latestBlockHash.blockhash,
  //         lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
  //         signature: txid,
  //       },
  //       'finalized',
  //     );
  //   }
  //   await new Promise((resolve) => setTimeout(resolve, 1000));

  // });

  // it("Purchase a Release", async () => {
  //   const purchaserTokenBalanceBefore = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
  //   const crsBalanceBefore = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');
  //   const [release] = await anchor.web3.PublicKey.findProgramAddress(
  //     [
  //       Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
  //       mint.publicKey.toBuffer(),
  //     ],
  //     program.programId
  //   );
  //   const [releaseSigner, releaseSignerBump] =
  //     anchor.web3.PublicKey.findProgramAddressSync(
  //       [release.toBuffer()],
  //       program.programId
  //     );
  //   console.log('crsTokenAccount', crsTokenAccount)
  //   const ix = await program.methods
  //     .releasePurchase(
  //       new anchor.BN(RELEASE_PRICE),
  //       releaseSignerBump,
  //       false,
  //     )
  //     .accounts({
  //       payer: purchaser.publicKey,
  //       receiver: purchaser.publicKey,
  //       release,
  //       releaseSigner,
  //       mint: mint.publicKey,
  //       paymentMint: paymentMint.publicKey,
  //       paymentTokenAccount: purchaserAta,
  //       royaltyTokenAccount,
  //       receiverReleaseTokenAccount: associatedAddress({
  //         mint: mint.publicKey,
  //         owner: purchaser.publicKey,
  //         tokenProgramId: TOKEN_2022_PROGRAM_ID,
  //       }),
  //       crsTokenAccount,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //       associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
  //       tokenProgramPayment: TOKEN_PROGRAM_ID,
  //       tokenProgramReleaseMint: TOKEN_2022_PROGRAM_ID,
  //     })
  //     .instruction();
  
  //   const txid = await buildSignAndSendTransaction(
  //     [modifyComputeUnits, addPriorityFee, ix],
  //     purchaser,
  //     lightConnection,
  //     []
  //   ).catch((err) => {
  //     console.log("Error", err);
  //   });
  //   if (txid) {
  //     const latestBlockHash = await lightConnection.getLatestBlockhash();
  //     await lightConnection.confirmTransaction(
  //       {
  //         blockhash: latestBlockHash.blockhash,
  //         lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
  //         signature: txid,
  //       },
  //       'finalized',
  //     );
  //   }
  //   await new Promise((resolve) => setTimeout(resolve, 1000));
  //   console.log("txid", txid);

  //   const crsBalance = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');

  //   const purchaserTokenBalance = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
  //   const royaltyTokenBalance = await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed');
  //   expect(Number(purchaserTokenBalance.value.amount)).to.equal(Number(purchaserTokenBalanceBefore.value.amount) - RELEASE_PRICE - CRS_FEE);
  //   expect(Number(crsBalance.value.amount)).to.equal(Number(crsBalanceBefore.value.amount) + CRS_FEE);
  //   expect(Number(royaltyTokenBalance.value.amount)).to.equal(RELEASE_PRICE);
  // });

  it("Initialize A $20 Release for publisher with paymentMint ATA", async () => {
    const balanceBefore = await lightConnection.getBalance(payer.publicKey);
    console.log("Balance before", balanceBefore);

    const { txid } = await buildAndSendReleaseInitV2Transaction(
      program,
      payer,
      artist,
      lightConnection,
      paymentMint,
      mint2,
      undefined,
      RELEASE_PRICE * 20
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

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
    const balanceAfter = await lightConnection.getBalance(
      payer.publicKey,
      "finalized"
    );
    console.log("Balance after", balanceAfter);

  });

  it.skip("Purchase a Release", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const purchaserTokenBalanceBefore = await lightConnection.getTokenAccountBalance(purchaserAta, 'finalized');
    const crsBalanceBefore = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'finalized');
    const royaltyTokenBalanceBefore = await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'finalized');

    const [release] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
        mint2.publicKey.toBuffer(),
      ],
      program.programId
    );
    const [releaseSigner, releaseSignerBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [release.toBuffer()],
        program.programId
      );

      console.log('royaltyTokenAccount', royaltyTokenAccount)
      console.log({
        payer: payer.publicKey,
        receiver: purchaser.publicKey,
        release,
        releaseSigner,
        mint: mint2.publicKey,
        paymentMint: paymentMint.publicKey,
        paymentTokenAccount: purchaserAta,
        royaltyTokenAccount,
        receiverReleaseTokenAccount: associatedAddress({
          mint: mint2.publicKey,
          owner: purchaser.publicKey,
          tokenProgramId: TOKEN_2022_PROGRAM_ID,
        }),
        crsTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        tokenProgramPayment: TOKEN_PROGRAM_ID,
        tokenProgramReleaseMint: TOKEN_2022_PROGRAM_ID,
      })

    
    const ix = await program.methods
      .releasePurchase(
        new anchor.BN(RELEASE_PRICE * 20),
        releaseSignerBump,
        false,
      )
      .accounts({
        payer: purchaser.publicKey,
        receiver: purchaser.publicKey,
        release,
        releaseSigner,
        mint: mint2.publicKey,
        paymentMint: paymentMint.publicKey,
        paymentTokenAccount: purchaserAta,
        royaltyTokenAccount,
        receiverReleaseTokenAccount: associatedAddress({
          mint: mint2.publicKey,
          owner: purchaser.publicKey,
          tokenProgramId: TOKEN_2022_PROGRAM_ID,
        }),
        crsTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        tokenProgramPayment: TOKEN_PROGRAM_ID,
        tokenProgramReleaseMint: TOKEN_2022_PROGRAM_ID,
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
    console.log('txid', txid)
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
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log("txid", txid);

    const crsBalance = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');
    console.log("crsBalance", crsBalance);
    // expect(Number(crsBalance.value.amount)).to.equal(Number(crsBalanceBefore.value.amount) + (RELEASE_PRICE * 2));

    const purchaserTokenBalance = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
    console.log("purchaserTokenBalance", purchaserTokenBalance);
    console.log("purchaserTokenBalanceBefore", purchaserTokenBalanceBefore);
    expect(Number(purchaserTokenBalance.value.amount)).to.equal(Number(purchaserTokenBalanceBefore.value.amount) - (RELEASE_PRICE * 20) - CRS_FEE);

    const royaltyTokenBalance = await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed');
    expect(Number(royaltyTokenBalance.value.amount)).to.equal(Number(royaltyTokenBalanceBefore.value.amount) + (RELEASE_PRICE * 20));

    expect(Number(crsBalance.value.amount)).to.equal(Number(crsBalanceBefore.value.amount) + CRS_FEE);
  });

  it("Initialize A Release and Purchase", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const purchaserTokenBalanceBefore = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
    const crsBalanceBefore = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');
    const royaltyTokenBalanceBefore = royaltyTokenAccount ? await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed') : 0;

    const [release] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
        mint3.publicKey.toBuffer(),
      ],
      program.programId
    );
    const [releaseSigner, releaseSignerBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [release.toBuffer()],
        program.programId
      );
    const royaltyTokenAccountAddress = await getAssociatedTokenAddress(
      paymentMint.publicKey,
      artist.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_PROGRAM_ID
    );
    royaltyTokenAccount = royaltyTokenAccountAddress;
    console.log('royaltyTokenAccount', royaltyTokenAccount)
    let royaltyTokenAccountExists;
    try {
      await getAccount(lightConnection, royaltyTokenAccountAddress);
      royaltyTokenAccountExists = true;
      console.log('royaltyTokenAccountExists', royaltyTokenAccountExists)
    } catch (error) {
      royaltyTokenAccountExists = false;
      console.log('royaltyTokenAccountExists', royaltyTokenAccountExists)
    }
  
    let instructions = [];
    if (!royaltyTokenAccountExists) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          royaltyTokenAccountAddress,
          artist.publicKey,
          paymentMint.publicKey,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_PROGRAM_ID
        )
      );
    }

    console.log({
      payer: purchaser.publicKey,
      receiver: purchaser.publicKey,
      authority: artist.publicKey,
      release,
      releaseSigner,
      mint: mint3.publicKey,
      paymentMint: paymentMint.publicKey,
      paymentTokenAccount: purchaserAta,
      royaltyTokenAccount,
      receiverReleaseTokenAccount: associatedAddress({
        mint: mint3.publicKey,
        owner: purchaser.publicKey,
        tokenProgramId: TOKEN_PROGRAM_ID,
      }),
      crsTokenAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    })
    const ix = await program.methods
      .releaseInitAndPurchase(
        releaseSignerBump,
        `rb9wx261pn2nCbiHtoqR2vQtZ3MRQ3qcyZeSSCE0Rm4`,
        1,
        "Nina Test",
        "NINA",
        new anchor.BN(100),
        new anchor.BN(RELEASE_PRICE),
      )
      .accountsStrict({
        payer: purchaser.publicKey,
        receiver: purchaser.publicKey,
        authority: artist.publicKey,
        release,
        mint: mint3.publicKey,
        releaseSigner,
        paymentMint: paymentMint.publicKey,
        paymentTokenAccount: purchaserAta,
        royaltyTokenAccount,
        receiverReleaseTokenAccount: associatedAddress({
          mint: mint3.publicKey,
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
      [modifyComputeUnits, addPriorityFee, ...instructions, ix],
      purchaser,
      lightConnection,
      [],
      [mint3]
    );
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
    console.log("txid", txid);

    // const crsBalance = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');
    // console.log("crsBalance", crsBalance);
    // expect(Number(crsBalance.value.amount)).to.equal(Number(crsBalanceBefore.value.amount) + CRS_FEE);

    const purchaserTokenBalance = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
    expect(Number(purchaserTokenBalance.value.amount)).to.equal(Number(purchaserTokenBalanceBefore.value.amount) - (RELEASE_PRICE));

    const royaltyTokenBalance = await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed');
    expect(Number(royaltyTokenBalance.value.amount)).to.equal(Number(royaltyTokenBalanceBefore === 0 ? 0 : royaltyTokenBalanceBefore.value.amount) + RELEASE_PRICE);
  });

  it("Initialize A Release and Purchase And Close", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const purchaserTokenBalanceBefore = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
    const crsBalanceBefore = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');
    const royaltyTokenBalanceBefore = royaltyTokenAccount ? await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed') : 0;

    const [release] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
        mint4.publicKey.toBuffer(),
      ],
      program.programId
    );
    const [releaseSigner, releaseSignerBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [release.toBuffer()],
        program.programId
      );
    const royaltyTokenAccountAddress = await getAssociatedTokenAddress(
      paymentMint.publicKey,
      artist.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_PROGRAM_ID
    );
    royaltyTokenAccount = royaltyTokenAccountAddress;
    console.log('royaltyTokenAccount', royaltyTokenAccount)
    let royaltyTokenAccountExists;
    try {
      await getAccount(lightConnection, royaltyTokenAccountAddress);
      royaltyTokenAccountExists = true;
      console.log('royaltyTokenAccountExists', royaltyTokenAccountExists)
    } catch (error) {
      royaltyTokenAccountExists = false;
      console.log('royaltyTokenAccountExists', royaltyTokenAccountExists)
    }
  
    let instructions = [];
    if (!royaltyTokenAccountExists) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          royaltyTokenAccountAddress,
          artist.publicKey,
          paymentMint.publicKey,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_PROGRAM_ID
        )
      );
    }

    console.log({
      payer: purchaser.publicKey,
      receiver: purchaser.publicKey,
      authority: artist.publicKey,
      release,
      releaseSigner,
      mint: mint4.publicKey,
      paymentMint: paymentMint.publicKey,
      paymentTokenAccount: purchaserAta,
      royaltyTokenAccount,
      receiverReleaseTokenAccount: associatedAddress({
        mint: mint4.publicKey,
        owner: purchaser.publicKey,
        tokenProgramId: TOKEN_PROGRAM_ID,
      }),
      crsTokenAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    })
    const ix = await program.methods
      .releaseInitAndPurchase(
        releaseSignerBump,
        `rb9wx261pn2nCbiHtoqR2vQtZ3MRQ3qcyZeSSCE0Rm4`,
        1,
        "Nina Test",
        "NINA",
        new anchor.BN(100),
        new anchor.BN(RELEASE_PRICE),
      )
      .accountsStrict({
        payer: purchaser.publicKey,
        receiver: purchaser.publicKey,
        authority: artist.publicKey,
        release,
        mint: mint4.publicKey,
        releaseSigner,
        paymentMint: paymentMint.publicKey,
        paymentTokenAccount: purchaserAta,
        royaltyTokenAccount,
        receiverReleaseTokenAccount: associatedAddress({
          mint: mint4.publicKey,
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
      [modifyComputeUnits, addPriorityFee, ...instructions, ix],
      purchaser,
      lightConnection,
      [],
      [mint4]
    );
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
    console.log("txid", txid);

    const purchaserTokenBalance = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
    expect(Number(purchaserTokenBalance.value.amount)).to.equal(Number(purchaserTokenBalanceBefore.value.amount) - (RELEASE_PRICE));

    const royaltyTokenBalance = await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed');
    expect(Number(royaltyTokenBalance.value.amount)).to.equal(Number(royaltyTokenBalanceBefore === 0 ? 0 : royaltyTokenBalanceBefore.value.amount) + RELEASE_PRICE);

    const closeIx = await program.methods
      .releaseClose()
      .accountsStrict({
        payer: artist.publicKey,
        authority: artist.publicKey,
        releaseSigner,
        release,
        mint: mint4.publicKey,
      })
      .instruction();

    const closeTxid = await buildSignAndSendTransaction(
      [modifyComputeUnits, addPriorityFee, closeIx],
      artist,
      lightConnection,
      [],
    );
    if (closeTxid) {
      const latestBlockHash = await lightConnection.getLatestBlockhash();
      await lightConnection.confirmTransaction(
        {
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: closeTxid,
        },
        'finalized',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("closeTxid", closeTxid);

    const releaseData = await program.account.releaseV2.fetch(release);
    expect(Number(releaseData.totalSupply)).to.equal(1);
    const mint4Supply = await lightConnection.getTokenSupply(mint4.publicKey, 'confirmed');
    expect(Number(mint4Supply.value.amount)).to.equal(1);
  });


  it("Update Metadata Token2022 Mint", async () => {
    const [release] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
        mint3.publicKey.toBuffer(),
      ],
      program.programId
    );
    const [releaseSigner, releaseSignerBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [release.toBuffer()],
        program.programId
      );
    const ix = await program.methods
      .releaseUpdate(
        `https://arweave.net/ZIdtfNs7XKWlIz3_n1CnfYhKNHlWgnHyM7SfNXrZ1aQ`,
        "Nina Test2",
        "NINA2",  
        releaseSignerBump,
        new anchor.BN(RELEASE_PRICE * 5),
        new anchor.BN(1000),
      )
      .accountsStrict({
        payer: artist.publicKey,
        authority: artist.publicKey,
        release,
        releaseSigner,
        mint: mint3.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    const txid = await buildSignAndSendTransaction(
      [modifyComputeUnits, addPriorityFee, ix],
      artist,
      lightConnection,
      [],
    );

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
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log("txid", txid);

    const metadata = await getTokenMetadata(lightConnection, mint3.publicKey, 'confirmed');
    console.log("metadata", metadata);
    expect(metadata.uri).to.equal(`https://arweave.net/ZIdtfNs7XKWlIz3_n1CnfYhKNHlWgnHyM7SfNXrZ1aQ`);
    expect(metadata.name).to.equal("Nina Test2");
    expect(metadata.symbol).to.equal("NINA2");

    const releaseData = await program.account.releaseV2.fetch(release);
    expect(Number(releaseData.price)).to.equal(RELEASE_PRICE * 5);
    expect(Number(releaseData.totalSupply)).to.equal(1000);
  });

});


describe.skip("Migrate Release V1 to V2", async () => {
  before(async () => {
    await Nina.init({
      endpoint: 'http://ec2-18-224-24-103.us-east-2.compute.amazonaws.com:3001/v1',
      rpcEndpoint: 'https://nina.devnet.rpcpool.com/e8d44ffc-1d21-4d80-bff3-c92500006d7c',
      programId: ninaV1ProgramId,
      programIdV2: program.programId,
      cluster: 'devnet',
    });
  });
  
  it("Get all releases from V1", async () => {
    const releases = await getReleasesFromV1();
    expect(releases.length).to.be.greaterThan(0);
    for (const release of releases) {
      expect(release.programId).to.equal(ninaV1ProgramId.toString());
    }
  });

  it("Get one release from V1", async() => {
    const releases = await getReleasesFromV1(1, 0, 1);
    expect(releases.length).to.equal(1);
    expect(releases[0].programId).to.equal(ninaV1ProgramId.toString());
  })

  it("Migrate one release from V1 to V2", async() => {
    let releases = await getReleasesFromV1(1, 0, 1);
    let tries = 0;
    while (releases.length === 0) {
      releases = await getReleasesFromV1(1, tries, 1);
      tries++;
      if (releases.length === 0) {
        console.log('no releases found, trying again');
      }
    }
    const release = releases[0];

    const { v2Release, v1ReleasePublicKey, authorityPublicKey, releaseMintPublicKey,  paymentMintPublicKey, v2AuthorityTokenAccount, v2ReleaseSigner, metadata } = await migrateReleaseFromV1ToV2(release);
    console.log('v2Release', v2Release);
    console.log('v1ReleasePublicKey', v1ReleasePublicKey);
    console.log('authorityPublicKey', authorityPublicKey);
    console.log('releaseMintPublicKey', releaseMintPublicKey);
    console.log('paymentMintPublicKey', paymentMintPublicKey);
    console.log('v2AuthorityTokenAccount', v2AuthorityTokenAccount);
    console.log('v2ReleaseSigner', v2ReleaseSigner);
    console.log('metadata', metadata);
    const releaseAfterUpdate = await db('releases').where('publicKey', v1ReleasePublicKey.toString()).first();
    expect(releaseAfterUpdate.programId).to.equal(program.programId.toString());
    expect(releaseAfterUpdate.solanaAddress).to.equal(v2Release.toString());
    expect(releaseAfterUpdate.migratedFromV1).to.be.true;
    console.log('releaseAfterUpdate', releaseAfterUpdate);

    const v2ReleaseData = await program.account.releaseV2.fetch(v2Release);
    expect(v2ReleaseData.authority.toString()).to.equal(authorityPublicKey.toString());
    expect(v2ReleaseData.mint.toString()).to.equal(releaseMintPublicKey.toString());
    expect(v2ReleaseData.releaseSigner.toString()).to.equal(v2ReleaseSigner.toString());
    expect(v2ReleaseData.paymentMint.toString()).to.equal(paymentMintPublicKey.toString());
    expect(v2ReleaseData.royaltyTokenAccount.toString()).to.equal(v2AuthorityTokenAccount.toString());
    const expectedTotalSupply = release.accountData.release.totalSupply === -1 ? Number(MAX_U64) : release.accountData.release.totalSupply;
    expect(Number(v2ReleaseData.totalSupply)).to.equal(expectedTotalSupply);
    expect(Number(v2ReleaseData.price)).to.equal(Number(release.accountData.release.price));
  })

  it("Migrate one release from V1 to V2 and update metaplex metadata", async() => {
    let releases = await getReleasesFromV1(1, 0, 1);
    let tries = 0;
    while (releases.length === 0) {
      releases = await getReleasesFromV1(1, tries, 1);
      tries++;
      if (releases.length === 0) {
        console.log('no releases found, trying again');
      }
    }
    const release = releases[0];

    const { v2Release, v1ReleasePublicKey, authorityPublicKey, releaseMintPublicKey,  paymentMintPublicKey, v2AuthorityTokenAccount, v2ReleaseSigner, v2ReleaseSignerBump, metadata } = await migrateReleaseFromV1ToV2(release);
    console.log('v2Release', v2Release);
    console.log('v1ReleasePublicKey', v1ReleasePublicKey);
    console.log('authorityPublicKey', authorityPublicKey);
    console.log('releaseMintPublicKey', releaseMintPublicKey);
    console.log('paymentMintPublicKey', paymentMintPublicKey);
    console.log('v2AuthorityTokenAccount', v2AuthorityTokenAccount);
    console.log('v2ReleaseSigner', v2ReleaseSigner);
    console.log('metadata', metadata);
    const releaseAfterUpdate = await db('releases').where('publicKey', v1ReleasePublicKey.toString()).first();
    expect(releaseAfterUpdate.programId).to.equal(program.programId.toString());
    expect(releaseAfterUpdate.solanaAddress).to.equal(v2Release.toString());
    expect(releaseAfterUpdate.migratedFromV1).to.be.true;
    console.log('releaseAfterUpdate', releaseAfterUpdate);

    const v2ReleaseData = await program.account.releaseV2.fetch(v2Release);
    expect(v2ReleaseData.authority.toString()).to.equal(authorityPublicKey.toString());
    expect(v2ReleaseData.mint.toString()).to.equal(releaseMintPublicKey.toString());
    expect(v2ReleaseData.releaseSigner.toString()).to.equal(v2ReleaseSigner.toString());
    expect(v2ReleaseData.paymentMint.toString()).to.equal(paymentMintPublicKey.toString());
    expect(v2ReleaseData.royaltyTokenAccount.toString()).to.equal(v2AuthorityTokenAccount.toString());
    const expectedTotalSupply = release.accountData.release.totalSupply === -1 ? Number(MAX_U64) : release.accountData.release.totalSupply;
    expect(Number(v2ReleaseData.totalSupply)).to.equal(expectedTotalSupply);
    expect(Number(v2ReleaseData.price)).to.equal(Number(release.accountData.release.price));

    const metadataProgram = new anchor.web3.PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
    const [metadataV2] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from('metadata'), metadataProgram.toBuffer(), releaseMintPublicKey.toBuffer()],
      metadataProgram,
    );

    const metadataData = {
      name: `Nina with the Nina`,
      symbol: `NINA`,
      uri: `https://arweave.net`,
      sellerFeeBasisPoints: 2000,
    }

    const ix = await program.methods
      .releaseUpdateMetaplex(
        metadataData,
        v2ReleaseSignerBump,
      )
      .accountsStrict({
        payer: provider.wallet.publicKey,
        authority: authorityPublicKey,
        release: v2Release,
        releaseSigner: v2ReleaseSigner,
        releaseMint: releaseMintPublicKey,
        metadata: metadataV2,
        tokenProgram: TOKEN_PROGRAM_ID,
        metadataProgram,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    const txid = await buildSignAndSendTransaction(
      [modifyComputeUnits, addPriorityFee, ix],
      provider.wallet.payer,
      lightConnection,
      [],
    );
    console.log('txid', txid);
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
  })


  // it("Migrate one release from V1 to V2 and purchase", async() => {
  //   const releases = await getReleasesFromV1(1, 0, 1);
  //   const release = releases[0];

  //   const { v2Release, v1ReleasePublicKey, authorityPublicKey, releaseMintPublicKey,  paymentMintPublicKey, v2AuthorityTokenAccount, v2ReleaseSigner, metadata } = await migrateReleaseFromV1ToV2(release);
  //   const v2ReleaseData = await program.account.releaseV2.fetch(v2Release);

  //   const tokenProgramReleaseMint = (await lightConnection.getAccountInfo(releaseMintPublicKey))?.owner;

  //   const purchaserTokenBalanceBefore = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
  //   const crsBalanceBefore = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');
  //   const [releasePublicKey] = await anchor.web3.PublicKey.findProgramAddress(
  //     [
  //       Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
  //       releaseMintPublicKey.toBuffer(),
  //     ],
  //     program.programId
  //   );
  //   const [releaseSigner, releaseSignerBump] =
  //     anchor.web3.PublicKey.findProgramAddressSync(
  //       [releasePublicKey.toBuffer()],
  //       program.programId
  //     );
  //   console.log('crsTokenAccount', crsTokenAccount)
  //   const ix = await program.methods
  //     .releasePurchase(
  //       v2ReleaseData.price,
  //       releaseSignerBump,
  //       false,
  //     )
  //     .accounts({
  //       payer: purchaser.publicKey,
  //       receiver: purchaser.publicKey,
  //       release: releasePublicKey,
  //       releaseSigner,
  //       mint: releaseMintPublicKey,
  //       paymentMint: paymentMint.publicKey,
  //       paymentTokenAccount: purchaserAta,
  //       royaltyTokenAccount: v2AuthorityTokenAccount,
  //       receiverReleaseTokenAccount: associatedAddress({
  //         mint: releaseMintPublicKey,
  //         owner: purchaser.publicKey,
  //         tokenProgramId: tokenProgramReleaseMint,
  //       }),
  //       crsTokenAccount,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //       associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
  //       tokenProgramPayment: TOKEN_PROGRAM_ID,
  //       tokenProgramReleaseMint,
  //     })
  //     .instruction();
  
  //   const txid = await buildSignAndSendTransaction(
  //     [modifyComputeUnits, addPriorityFee, ix],
  //     purchaser,
  //     lightConnection,
  //     []
  //   ).catch((err) => {
  //     console.log("Error", err);
  //   });
  //   if (txid) {
  //     const latestBlockHash = await lightConnection.getLatestBlockhash();
  //     await lightConnection.confirmTransaction(
  //       {
  //         blockhash: latestBlockHash.blockhash,
  //         lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
  //         signature: txid,
  //       },
  //       'finalized',
  //     );
  //   }
  //   await new Promise((resolve) => setTimeout(resolve, 1000));
  //   console.log("txid", txid);

  //   const crsBalance = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');

  //   const purchaserTokenBalance = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
  //   const royaltyTokenBalance = await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed');
  //   expect(Number(purchaserTokenBalance.value.amount)).to.equal(Number(purchaserTokenBalanceBefore.value.amount) - RELEASE_PRICE - CRS_FEE);
  //   expect(Number(crsBalance.value.amount)).to.equal(Number(crsBalanceBefore.value.amount) + CRS_FEE);
  //   expect(Number(royaltyTokenBalance.value.amount)).to.equal(RELEASE_PRICE);

  // })
})


const buildAndSendReleaseInitV2Transaction = async (
  program: Program<NinaV2>,
  payer: Keypair,
  artist: Keypair,
  lightConnection: anchor.web3.Connection,
  paymentMint: Keypair,
  mint: Keypair,
  lookupTableAddress: PublicKey,
  price: number = RELEASE_PRICE,
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
    artist.publicKey,
    false,
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
        artist.publicKey,
        paymentMint.publicKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_PROGRAM_ID
      )
    );
  }

  const ix = await program.methods
    .releaseInitV2(
      `rb9wx261pn2nCbiHtoqR2vQtZ3MRQ3qcyZeSSCE0Rm4`,
      1,
      "Nina Test",
      "NINA",
      new anchor.BN(100),
      new anchor.BN(price),
      releaseSignerBump
    )
    .accountsStrict({
      payer: payer.publicKey,
      authority: artist.publicKey,
      release,
      mint: mint.publicKey,
      releaseSigner,
      paymentMint: paymentMint.publicKey,
      royaltyTokenAccount,
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
    console.log('base64', Buffer.from(tx.serialize()).toString('base64'));
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

const getReleasesFromV1 = async (limit: number = 100, offset: number = 0, total: number = 0) => {
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
        total = releaseAccounts.length;
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

const migrateReleaseFromV1ToV2 = async (release: any) => {
  try {
    console.log('release', release);

    const authorityPublicKey = new anchor.web3.PublicKey(release.publisher);
    const v1ReleasePublicKey = new anchor.web3.PublicKey(release.publicKey);
    const releaseMintPublicKey = new anchor.web3.PublicKey(release.mint);
    const releaseSignerPublicKey = new anchor.web3.PublicKey(release.accountData.release.releaseSigner);
    const v1PaymentMintPublicKey = new anchor.web3.PublicKey(release.accountData.release.paymentMint);
    const royaltyTokenAccountPublicKey = new anchor.web3.PublicKey(release.accountData.release.royaltyTokenAccount);
    // just for testing
    const paymentMintPublicKey = new anchor.web3.PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

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
    const [v2ReleaseSigner, v2ReleaseSignerBump] =
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
      let txid;
      try {
        txid = await buildSignAndSendTransaction(
          [modifyComputeUnits, addPriorityFee, ix],
          provider.wallet.payer,
          lightConnection,
          [],
        );
      } catch (error) {
        console.log('error', error);
        throw new Error(error);
      }
    let tx;
    if (txid) {
      const latestBlockHash = await lightConnection.getLatestBlockhash();
      tx = await lightConnection.confirmTransaction(
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
    await db('releases').where('publicKey', v1ReleasePublicKey.toString()).update({
      programId: program.programId.toString(),
      solanaAddress: v2Release.toString(),
      // just for testing
      paymentMint: paymentMintPublicKey.toString(),
      migratedFromV1: true,
    });
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
      v2ReleaseSignerBump,
      metadata,
    }
  } catch (error) {
    console.log('error', error);
    throw new Error(error);
  }
}