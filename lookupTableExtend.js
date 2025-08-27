const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, VersionedTransaction, AddressLookupTableProgram } = require("@solana/web3.js");

const SIGNER_WALLET = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SIGNER_WALLET_SECRET_KEY)));
const LOOKUP_TABLE_ADDRESS_DEVNET = new PublicKey('Bx9XmjHzZikpThnPSDTAN2sPGxhpf41pyUmEQ1h51QpH');
const LOOKUP_TABLE_ADDRESS_MAINNET = new PublicKey('AGn3U5JJoN6QXaaojTow2b3x1p4ucPs8SbBpQZf6c1o9');

async function addAddressesToTable(isMainnet = false) {
  const LOOKUP_TABLE_ADDRESS = isMainnet ? LOOKUP_TABLE_ADDRESS_MAINNET : LOOKUP_TABLE_ADDRESS_DEVNET;
  const keysRaw = fs.readFileSync(process.env.NINA_FILE_SERVICE_WALLET_PATH);

  const keypair = Keypair.fromSecretKey(keysRaw);
  // Step 1 - Create Transaction Instruction
  const addAddressesInstruction = AddressLookupTableProgram.extendLookupTable({
      payer: SIGNER_WALLET.publicKey,
      authority: SIGNER_WALLET.publicKey,
      lookupTable: LOOKUP_TABLE_ADDRESS,
      addresses: [
          Keypair.generate().publicKey,
          Keypair.generate().publicKey,
          Keypair.generate().publicKey,
          Keypair.generate().publicKey,
          Keypair.generate().publicKey
      ],
  });
  // Step 2 - Generate a transaction and send it to the network

  const connection = new Connection(isMainnet ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
  const latestBlockhash = await connection.getLatestBlockhash();
  const transaction = new Transaction().add(addAddressesInstruction);
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.sign(SIGNER_WALLET);
  const signature = await connection.sendTransaction(transaction, { skipPreflight: true });
  console.log(`Transaction sent: `,`https://explorer.solana.com/tx/${signature}?cluster=${isMainnet ? 'mainnet-beta' : 'devnet'}`);
  await createAndSendV0Tx([addAddressesInstruction]);
  console.log(`Lookup Table Entries: `,`https://explorer.solana.com/address/${LOOKUP_TABLE_ADDRESS.toString()}/entries?cluster=devnet`)
}

