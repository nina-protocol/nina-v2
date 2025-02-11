import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NinaV2 } from "../target/types/nina_v2";
import { PublicKey, Keypair } from "@solana/web3.js";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { assert, expect } from "chai";
import fs from "fs";
import path from "path";

import {
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as borsh from "borsh";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
} from "@solana/web3.js";

import {
  LightSystemProgram,
  NewAddressParams,
  Rpc,
  bn,
  createRpc,
  defaultStaticAccountsStruct,
  defaultTestStateTreeAccounts,
  deriveAddress,
  createBN254,
  hashToBn254FieldSizeBe,
  packCompressedAccounts,
  packNewAddressParams,
  CompressedAccountWithMerkleContext,
  airdropSol,
} from "@lightprotocol/stateless.js";
import { OrpAccountSchema, OrpConfigSchema } from "./helpers/schemas";
import {
  buildSignAndSendTransaction,
  formatRemainingAccounts,
} from "./helpers/compression";

const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

const program = anchor.workspace.NinaV2 as Program<NinaV2>;
const lightConnection: Rpc = createRpc();

const provider = new anchor.AnchorProvider(lightConnection, anchor.Wallet.local(), anchor.AnchorProvider.defaultOptions());
anchor.setProvider(provider);
console.log("lightConnection", lightConnection);
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

  const orpTestAccounts = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "./helpers/orp-test-accounts.json"),
      "utf8"
    )
  );
  console.log("orpTestAccounts", orpTestAccounts);
  console.log(
    "orpTestAccounts.deployer._keypair.secretKey",
    orpTestAccounts.deployer._keypair.secretKey.data
  );
  console.log(
    "Object.values(orpTestAccounts.paymentMint._keypair.secretKey)",
    Object.values(orpTestAccounts.paymentMint._keypair.secretKey)
  );
  console.log(
    "Object.values(orpTestAccounts.deployer._keypair.secretKey)",
    orpTestAccounts.deployer._keypair.secretKey.data
  );
  console.log(
    "new Uint8Array(Object.values(orpTestAccounts.paymentMint._keypair.secretKey))",
    new Uint8Array(
      Object.values(orpTestAccounts.paymentMint._keypair.secretKey)
    )
  );
  const paymentMint = Keypair.fromSecretKey(
    new Uint8Array(
      Object.values(orpTestAccounts.paymentMint._keypair.secretKey)
    )
  );
  const orpDeployer = Keypair.fromSecretKey(
    new Uint8Array(orpTestAccounts.deployer._keypair.secretKey.data)
  );
  let {
    lookupTableAddress,
    orpConfigAddress,
    orpAccount1Address,
    orpAccount2Address,
    orpAccount3Address,
    orpAccount4Address,
    treasuryAddress,
    orpProgramId,
    orpPoolPublicKey,
    cpiAuthorityPda,
    merkleTree,
    nullifierQueue,
    addressTree,
    addressQueue,
  } = orpTestAccounts;

  lookupTableAddress = new anchor.web3.PublicKey(lookupTableAddress);
  orpAccount1Address = new anchor.web3.PublicKey(orpAccount1Address);
  orpAccount2Address = new anchor.web3.PublicKey(orpAccount2Address);
  orpAccount3Address = new anchor.web3.PublicKey(orpAccount3Address);
  orpAccount4Address = new anchor.web3.PublicKey(orpAccount4Address);
  orpPoolPublicKey = new anchor.web3.PublicKey(orpPoolPublicKey);
  orpProgramId = new anchor.web3.PublicKey(orpProgramId);
  orpConfigAddress = new anchor.web3.PublicKey(orpConfigAddress);
  treasuryAddress = new anchor.web3.PublicKey(treasuryAddress);
  cpiAuthorityPda = new anchor.web3.PublicKey(cpiAuthorityPda);
  merkleTree = new anchor.web3.PublicKey(merkleTree);
  nullifierQueue = new anchor.web3.PublicKey(nullifierQueue);
  addressTree = new anchor.web3.PublicKey(addressTree);
  addressQueue = new anchor.web3.PublicKey(addressQueue);


  
  const {
    accountCompressionAuthority,
    noopProgram,
    registeredProgramPda,
    accountCompressionProgram,
  } = defaultStaticAccountsStruct();

console.log('registeredProgramPda', registeredProgramPda)
  it("airdrop payer", async () => {
    console.log("before airdrop");
    const tx = await lightConnection
      .requestAirdrop(payer.publicKey, 10000000000)
      .catch((err) => console.log("err", err));
    console.log("tx", tx);
    let confirmed;
    while (!confirmed && tx) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      confirmed = await lightConnection.getSignatureStatuses([tx]);
      if (!confirmed) continue;
      if (confirmed.value[0].err) {
        throw new Error(confirmed.value[0].err.toString());
      }
      if (confirmed.value[0].confirmationStatus === "confirmed") {
        confirmed = true;
        break;
      }
    }

    const balanceAfterAirdrop = await lightConnection.getBalance(
      payer.publicKey
    );
    console.log("Balance after airdrop", balanceAfterAirdrop);
  });

  it("airdrop purchaser", async () => {
    const tx = await lightConnection.requestAirdrop(
      purchaser.publicKey,
      10000000000
    );
    console.log("tx", tx);
    let confirmed;
    while (!confirmed) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      confirmed = await lightConnection.getSignatureStatuses([tx]);
      if (!confirmed) continue;
      if (confirmed.value[0].err) {
        throw new Error(confirmed.value[0].err.toString());
      }
      if (confirmed.value[0].confirmationStatus === "confirmed") {
        confirmed = true;
        break;
      }
    }

    const balanceAfterAirdrop = await lightConnection.getBalance(
      purchaser.publicKey
    );
    console.log("Balance after airdrop", balanceAfterAirdrop);
  });

  it("create payment mint", async () => {
    purchaserAta = await createAssociatedTokenAccount(
      lightConnection,
      purchaser,
      paymentMint.publicKey,
      purchaser.publicKey
    );

    await mintTo(
      lightConnection,
      purchaser,
      paymentMint.publicKey,
      purchaserAta,
      orpDeployer,
      RELEASE_PRICE * 10
    );
  });

  it("extend lookup table", async () => {
    const lookupTableAccount = (
      await lightConnection.getAddressLookupTable(lookupTableAddress)
    ).value;
    console.log("lookupTableAccount", lookupTableAccount);
    
    const extendInstruction = anchor.web3.AddressLookupTableProgram.extendLookupTable({
      payer: orpDeployer.publicKey,
      authority: orpDeployer.publicKey,
      lookupTable: lookupTableAddress,
      addresses: [
        program.programId,
        ComputeBudgetProgram.programId,
        orpAccount1Address,
        orpAccount2Address,
        orpAccount3Address,
        orpAccount4Address,
        orpConfigAddress,
        TOKEN_2022_PROGRAM_ID,
      ],
    });

    const { blockhash } = await lightConnection.getLatestBlockhash();

    const messageV0 = new anchor.web3.TransactionMessage({
      payerKey: orpDeployer.publicKey,
      recentBlockhash: blockhash,
      instructions: [modifyComputeUnits, addPriorityFee, extendInstruction],
    }).compileToV0Message([lookupTableAccount])
    console.log("messageV0", messageV0)
    const tx = new anchor.web3.VersionedTransaction(messageV0)
    console.log("tx", tx)
    tx.sign([orpDeployer])
    const txid = await lightConnection.sendRawTransaction(tx.serialize())

    console.log("txid", txid);
      
  })

  it("Initialize A Release for publisher without paymentMint ATA", async () => {
    const balanceBefore = await lightConnection.getBalance(payer.publicKey);
    console.log("Balance before", balanceBefore);

    const { release } = await buildAndSendReleaseInitV2Transaction(
      program,
      payer,
      lightConnection,
      paymentMint,
      mint,
      lookupTableAddress,
      orpDeployer
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const releaseAccount = await program.account.releaseV2.fetch(release);
    console.log("Release", releaseAccount);
    const balanceAfter = await lightConnection.getBalance(
      payer.publicKey,
      "confirmed"
    );
    console.log("Balance after", balanceAfter);
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

    console.log('orpConfigAddress', orpConfigAddress)
    const orpConfigData = await lightConnection.getCompressedAccount(
      bn(orpConfigAddress.toBytes())
    );
    const orpConfig: any = borsh.deserialize(
      OrpConfigSchema,
      orpConfigData.data.data
    );

    const orpAccount1Data = await lightConnection.getCompressedAccount(
      bn(orpAccount1Address.toBytes())
    );
    console.log("orpAccount1Data", orpAccount1Data);
    const orpAccount2Data = await lightConnection.getCompressedAccount(
      bn(orpAccount2Address.toBytes())
    );
    console.log("orpAccount2Data", orpAccount2Data);
    const orpAccount3Data = await lightConnection.getCompressedAccount(
      bn(orpAccount3Address.toBytes())
    );
    console.log("orpAccount3Data", orpAccount3Data);
    const orpAccount4Data = await lightConnection.getCompressedAccount(
      bn(orpAccount4Address.toBytes())
    );
    console.log("orpAccount4Data", orpAccount4Data);

    const orpAccount1: any = borsh.deserialize(
      OrpAccountSchema,
      orpAccount1Data.data.data
    );
    console.log("orpAccount1", orpAccount1);
    const orpAccount2: any = borsh.deserialize(
      OrpAccountSchema,
      orpAccount2Data.data.data
    );
    console.log("orpAccount2", orpAccount2);
    const orpAccount3: any = borsh.deserialize(
      OrpAccountSchema,
      orpAccount3Data.data.data
    );
    console.log("orpAccount3", orpAccount3);
    const orpAccount4: any = borsh.deserialize(
      OrpAccountSchema,
      orpAccount4Data.data.data
    );
    console.log("orpAccount4", orpAccount4);
    const orpAccountProof = await lightConnection.getValidityProofV0([
      {
        hash: bn(Uint8Array.from(orpAccount1Data.hash)),
        tree: addressTree,
        queue: addressQueue,
      },
      {
        hash: bn(Uint8Array.from(orpAccount2Data.hash)),
        tree: addressTree,
        queue: addressQueue,
      },
      {
        hash: bn(Uint8Array.from(orpAccount3Data.hash)),
        tree: addressTree,
        queue: addressQueue,
      },
      {
        hash: bn(Uint8Array.from(orpAccount4Data.hash)),
        tree: addressTree,
        queue: addressQueue,
      },
    ]);
    console.log('orpAccount1Data.hash', orpAccount1Data.hash)
    console.log('orpAccount2Data.hash', orpAccount2Data.hash)
    console.log('orpAccount3Data.hash', orpAccount3Data.hash)
    console.log('orpAccount4Data.hash', orpAccount4Data.hash)
    console.log("orpAccountProof", orpAccountProof);
    const inputCompressedAccount1: CompressedAccountWithMerkleContext = {
      merkleTree,
      nullifierQueue,
      hash: orpAccount1Data.hash,
      leafIndex: orpAccount1Data.leafIndex,
      readOnly: false,
      owner: orpAccount1Data.owner,
      lamports: orpAccount1Data.lamports,
      address: orpAccount1Data.address,
      data: orpAccount1Data.data,
    };
    const inputCompressedAccount2: CompressedAccountWithMerkleContext = {
      merkleTree,
      nullifierQueue,
      hash: orpAccount2Data.hash,
      leafIndex: orpAccount2Data.leafIndex,
      readOnly: false,
      owner: orpAccount2Data.owner,
      lamports: orpAccount2Data.lamports,
      address: orpAccount2Data.address,
      data: orpAccount2Data.data,
    };
    const inputCompressedAccount3: CompressedAccountWithMerkleContext = {
      merkleTree,
      nullifierQueue,
      hash: orpAccount3Data.hash,
      leafIndex: orpAccount3Data.leafIndex,
      readOnly: false,
      owner: orpAccount3Data.owner,
      lamports: orpAccount3Data.lamports,
      address: orpAccount3Data.address,
      data: orpAccount3Data.data,
    };

    const inputCompressedAccount4: CompressedAccountWithMerkleContext = {
      merkleTree,
      nullifierQueue,
      hash: orpAccount4Data.hash,
      leafIndex: orpAccount4Data.leafIndex,
      readOnly: false,
      owner: orpAccount4Data.owner,
      lamports: orpAccount4Data.lamports,
      address: orpAccount4Data.address,
      data: orpAccount4Data.data,
    };

    const { packedInputCompressedAccounts, remainingAccounts } =
      packCompressedAccounts(
        [
          inputCompressedAccount1,
          inputCompressedAccount2,
          inputCompressedAccount3,
          inputCompressedAccount4,
        ],
        orpAccountProof.rootIndices,
        []
      );
    console.log("packedInputCompressedAccounts", packedInputCompressedAccounts);
    packedInputCompressedAccounts.forEach(account => {
      console.log('account address', new Uint8Array(account.compressedAccount.address))
      console.log('account data', account.compressedAccount.data)
    })
    orpAccountProof.roots.forEach(root => {
      console.log('root', new Uint8Array(root.toArray()))
    })
    orpAccountProof.leaves.forEach(leaf => {
      console.log('leaf', new Uint8Array(leaf.toArray()))
    })
    //   console.log(        new anchor.BN(RELEASE_PRICE),
  //   releaseSignerBump,
  //   orpAccountProof.compressedProof,
  //   {
  //     merkleTreePubkeyIndex:
  //       packedInputCompressedAccounts[0].merkleContext
  //         .merkleTreePubkeyIndex,
  //     nullifierQueuePubkeyIndex:
  //       packedInputCompressedAccounts[0].merkleContext
  //         .nullifierQueuePubkeyIndex,
  //   },
  //   packedInputCompressedAccounts[0].rootIndex,
  //   [
  //     orpAccount1Data.leafIndex,
  //     orpAccount2Data.leafIndex,
  //     orpAccount3Data.leafIndex,
  //     orpAccount4Data.leafIndex,
  //   ],
  //   {
  //     address: Array.from(orpConfigAddress.toBytes()),
  //     authority: Array.from(orpConfig.authority),
  //     pool: Array.from(orpConfig.pool),
  //     firstMinterPercent: bn(orpConfig.first_minter_percent),
  //     inviteReferralPercent: bn(orpConfig.invite_referral_percent),
  //     purchaseReferralPercent: bn(orpConfig.purchase_referral_percent),
  //     topSupportersPercent: bn(orpConfig.top_supporters_percent),
  //     treasuryPercent: bn(orpConfig.treasury_percent),
  //     feeBasisPoints: bn(orpConfig.fee_basis_points),
  //     feeBase: bn(orpConfig.fee_base),
  //   },
  //   [
  //     Array.from(orpAccount1Address.toBytes()),
  //     Array.from(orpAccount2Address.toBytes()),
  //     Array.from(orpAccount3Address.toBytes()),
  //     Array.from(orpAccount4Address.toBytes()),
  //   ],
  //   [orpAccount1, orpAccount2, orpAccount3, orpAccount4]
  // )
  // console.log({
  //   payer: purchaser.publicKey,
  //   receiver: purchaser.publicKey,
  //   release,
  //   releaseSigner,
  //   mint: mint.publicKey,
  //   paymentMint: paymentMint.publicKey,
  //   paymentTokenAccount: purchaserAta,
  //   royaltyTokenAccount,
  //   receiverReleaseTokenAccount: associatedAddress({
  //     mint: mint.publicKey,
  //     owner: purchaser.publicKey,
  //     tokenProgramId: TOKEN_2022_PROGRAM_ID,
  //   }),
  //   systemProgram: anchor.web3.SystemProgram.programId,
  //   associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
  //   tokenProgram: TOKEN_PROGRAM_ID,
  //   token2022Program: TOKEN_2022_PROGRAM_ID,
  //   orpProgram: orpProgramId,
  //   orpCpiAuthorityPda: cpiAuthorityPda,
  //   orpPool: orpPoolPublicKey,
  //   treasuryTokenAccount: treasuryAddress,
  //   lightSystemProgram: LightSystemProgram.programId,
  //   accountCompressionAuthority,
  //   noopProgram,
  //   accountCompressionProgram,
  //   registeredProgramPda,
  // })

  console.log([
    Array.from(orpAccount1Address.toBytes()),
    Array.from(orpAccount2Address.toBytes()),
    Array.from(orpAccount3Address.toBytes()),
    Array.from(orpAccount4Address.toBytes()),
  ])
    const ix = await program.methods
      .releasePurchase(
        new anchor.BN(RELEASE_PRICE),
        releaseSignerBump,
        orpAccountProof.compressedProof,
        {
          merkleTreePubkeyIndex:
            packedInputCompressedAccounts[0].merkleContext
              .merkleTreePubkeyIndex,
          nullifierQueuePubkeyIndex:
            packedInputCompressedAccounts[0].merkleContext
              .nullifierQueuePubkeyIndex,
        },
        packedInputCompressedAccounts[0].rootIndex,
        orpAccountProof.leafIndices,
        {
          address: Array.from(orpConfigAddress.toBytes()),
          authority: Array.from(orpConfig.authority),
          pool: Array.from(orpConfig.pool),
          firstMinterPercent: bn(orpConfig.first_minter_percent),
          inviteReferralPercent: bn(orpConfig.invite_referral_percent),
          purchaseReferralPercent: bn(orpConfig.purchase_referral_percent),
          topSupportersPercent: bn(orpConfig.top_supporters_percent),
          treasuryPercent: bn(orpConfig.treasury_percent),
          feeBasisPoints: bn(orpConfig.fee_basis_points),
          feeBase: bn(orpConfig.fee_base),
        },
        [
          Array.from(orpAccount1Address.toBytes()),
          Array.from(orpAccount2Address.toBytes()),
          Array.from(orpAccount3Address.toBytes()),
          Array.from(orpAccount4Address.toBytes()),
        ],
        [orpAccount1, orpAccount2, orpAccount3, orpAccount4]
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
        orpProgram: orpProgramId,
        orpCpiAuthorityPda: cpiAuthorityPda,
        orpPool: orpPoolPublicKey,
        treasuryTokenAccount: treasuryAddress,
        lightSystemProgram: LightSystemProgram.programId,
        accountCompressionAuthority,
        noopProgram,
        accountCompressionProgram,
        registeredProgramPda,
      })
      .remainingAccounts(formatRemainingAccounts(remainingAccounts))
      .instruction();

      const lookupTableAccount = (
        await lightConnection.getAddressLookupTable(lookupTableAddress)
      ).value;
  
    const txid = await buildSignAndSendTransaction(
      [modifyComputeUnits, addPriorityFee, ix],
      purchaser,
      lightConnection,
      [lookupTableAccount]
    ).catch((err) => {
      console.log("Error", err);
    });

    console.log("txid", txid);
  });
});

const buildAndSendReleaseInitV2Transaction = async (
  program: Program<NinaV2>,
  payer: Keypair,
  lightConnection: Rpc,
  paymentMint: Keypair,
  mint: Keypair,
  lookupTableAddress: PublicKey,
  orpDeployer: Keypair
) => {
  const [release] = await anchor.web3.PublicKey.findProgramAddress(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode("nina-release")),
      mint.publicKey.toBuffer(),
    ],
    program.programId
  );
  console.log("release", release);
  const [releaseSigner, releaseSignerBump] =
    anchor.web3.PublicKey.findProgramAddressSync(
      [release.toBuffer()],
      program.programId
    );
  console.log("releaseSigner", releaseSigner);
  const associatedAddress = await getAssociatedTokenAddress(
    paymentMint.publicKey,
    releaseSigner,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_PROGRAM_ID
  );
  console.log("associatedAddress", associatedAddress);
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
  console.log("instructions", instructions);
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
  console.log("ix", ix);
    const lookupTableAccount = (
      await lightConnection.getAddressLookupTable(lookupTableAddress)
    ).value;

  const { blockhash } = await lightConnection.getLatestBlockhash();

    const messageV0 = new anchor.web3.TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [modifyComputeUnits, addPriorityFee, ...instructions, ix],
    }).compileToV0Message([lookupTableAccount])
    console.log("messageV0", messageV0)
    const tx = new anchor.web3.VersionedTransaction(messageV0)
    console.log("tx", tx)
    tx.sign([payer, mint])
    const txid = await lightConnection.sendRawTransaction(tx.serialize())
  console.log("Your transaction signature", txid);

  
  const extendInstruction = anchor.web3.AddressLookupTableProgram.extendLookupTable({
    payer: orpDeployer.publicKey,
    authority: orpDeployer.publicKey,
    lookupTable: lookupTableAddress,
    addresses: [
      release,
      releaseSigner,
      mint.publicKey,
      associatedAddress,
      payer.publicKey,
    ],
  });
  const messageV02 = new anchor.web3.TransactionMessage({
    payerKey: orpDeployer.publicKey,
    recentBlockhash: blockhash,
    instructions: [modifyComputeUnits, addPriorityFee, extendInstruction],
  }).compileToV0Message([lookupTableAccount])
  console.log("messageV0", messageV02)
  const tx2 = new anchor.web3.VersionedTransaction(messageV02)
  console.log("tx", tx2)
  tx2.sign([orpDeployer])
  const txid2 = await lightConnection.sendRawTransaction(tx2.serialize())

  console.log("extended release account lookup txid", txid2);


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
