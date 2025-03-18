import { TransactionInstruction, Keypair, Connection, AddressLookupTableAccount, Signer } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
export const buildSignAndSendTransaction = async (
  instructions: TransactionInstruction[],
  payer: Keypair,
  connection: Connection,
  lookupTableAccount?: AddressLookupTableAccount[],
  additionalSigners: Signer[] = []
) => {
  const { blockhash } = await connection.getLatestBlockhash();
  const messageV0 = new anchor.web3.TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([...lookupTableAccount])
  console.log("messageV0", messageV0)
  const tx = new anchor.web3.VersionedTransaction(messageV0)
  console.log("tx", tx)
  tx.sign([payer, ...additionalSigners])
  const txid = await connection.sendRawTransaction(tx.serialize())
  return txid;
};