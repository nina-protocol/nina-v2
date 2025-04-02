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

import {
  buildSignAndSendTransaction,
} from "./helpers/index";
import { expect } from "chai";

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

  const artist = Keypair.generate();
  const payer = Keypair.generate();
  const mint = Keypair.generate();
  const mint2 = Keypair.generate();
  const mint3 = Keypair.generate();
  const purchaser = Keypair.generate();
  const paymentMint = Keypair.generate();
  const ninaTreasury = Keypair.generate().publicKey;
  let purchaserAta: PublicKey;
  let payerAta: PublicKey;
  let ninaTreasuryAta: PublicKey;
  let crsAccount = Keypair.generate();
  let crsTokenAccount: PublicKey;

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
      crsAccount.publicKey,
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

  it("Initialize A Release for publisher without paymentMint ATA", async () => {
    const balanceBefore = await lightConnection.getBalance(payer.publicKey);
    console.log("Balance before", balanceBefore);

    const { release, txid } = await buildAndSendReleaseInitV2Transaction(
      program,
      payer,
      artist,
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
    const purchaserTokenBalanceBefore = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');

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
    console.log('crsTokenAccount', crsTokenAccount)
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
        crsTokenAccount,
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
        'finalized',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("txid", txid);

    // const crsBalance = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');

    const purchaserTokenBalance = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
    const royaltyTokenBalance = await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed');
    expect(Number(purchaserTokenBalance.value.amount)).to.equal(Number(purchaserTokenBalanceBefore.value.amount) - (RELEASE_PRICE));
    // expect(Number(crsBalance.value.amount)).to.equal(RELEASE_PRICE);
    expect(Number(royaltyTokenBalance.value.amount)).to.equal(RELEASE_PRICE);
  });

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
    const balanceAfter = await lightConnection.getBalance(
      payer.publicKey,
      "finalized"
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
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const purchaserTokenBalanceBefore = await lightConnection.getTokenAccountBalance(purchaserAta, 'finalized');
    // const crsBalanceBefore = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'finalized');
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
        // crsTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })

    
    const ix = await program.methods
      .releasePurchase(
        new anchor.BN(RELEASE_PRICE * 20),
        releaseSignerBump,
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
        // crsTokenAccount,
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

    // const crsBalance = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');
    // console.log("crsBalance", crsBalance);
    // expect(Number(crsBalance.value.amount)).to.equal(Number(crsBalanceBefore.value.amount) + (RELEASE_PRICE * 2));

    const purchaserTokenBalance = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
    expect(Number(purchaserTokenBalance.value.amount)).to.equal(Number(purchaserTokenBalanceBefore.value.amount) - (RELEASE_PRICE * 20));

    const royaltyTokenBalance = await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed');
    expect(Number(royaltyTokenBalance.value.amount)).to.equal(Number(royaltyTokenBalanceBefore.value.amount) + (RELEASE_PRICE * 20));
  });

  it("Initialize A Release and Purchase", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const purchaserTokenBalanceBefore = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
    // const crsBalanceBefore = await lightConnection.getTokenAccountBalance(crsTokenAccount, 'confirmed');
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
      // crsTokenAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    })
    const ix = await program.methods
      .releaseInitAndPurchase(
        releaseSignerBump,
        `https://arweave.net/rb9wx261pn2nCbiHtoqR2vQtZ3MRQ3qcyZeSSCE0Rm4`,
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
        crsTokenAccount,
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
    // expect(Number(crsBalance.value.amount)).to.equal(Number(crsBalanceBefore.value.amount) + RELEASE_PRICE);

    const purchaserTokenBalance = await lightConnection.getTokenAccountBalance(purchaserAta, 'confirmed');
    expect(Number(purchaserTokenBalance.value.amount)).to.equal(Number(purchaserTokenBalanceBefore.value.amount) - (RELEASE_PRICE));

    const royaltyTokenBalance = await lightConnection.getTokenAccountBalance(royaltyTokenAccount, 'confirmed');
    expect(Number(royaltyTokenBalance.value.amount)).to.equal(Number(royaltyTokenBalanceBefore === 0 ? 0 : royaltyTokenBalanceBefore.value.amount) + RELEASE_PRICE);
  });

  it("Update Metadata", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
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
      `https://arweave.net/rb9wx261pn2nCbiHtoqR2vQtZ3MRQ3qcyZeSSCE0Rm4`,
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
