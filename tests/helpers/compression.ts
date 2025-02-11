import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  buildAndSignTx,
  CompressedAccount,
  CompressedAccountWithMerkleContext,
  CompressedProofWithContext,
  defaultTestStateTreeAccounts,
  getIndexOrAdd,
  NewAddressParams,
  packCompressedAccounts,
  PackedMerkleContext,
  packNewAddressParams,
  Rpc,
  sendAndConfirmTx,
} from "@lightprotocol/stateless.js";

/**
 * Hashes an array of byte arrays using Keccak-256 and returns the result as a Uint8Array.
 * The first byte of the result is set to 0 to ensure it fits within the BN254 field size.
 * @param {Uint8Array[]} bytes - Array of byte arrays to be hashed
 * @returns {Uint8Array} The resulting hash as a Uint8Array
 */
export const hashvToBn254FieldSizeBe = (bytes: Uint8Array[]): Uint8Array => {
  const hasher = keccak_256.create();
  for (const input of bytes) {
    hasher.update(input);
  }
  const hash = hasher.digest();
  hash[0] = 0;
  return hash;
};

/**
 * Derives an address seed from given seeds, program ID, and address merkle tree.
 * @param {Uint8Array[]} seeds - Array of seed byte arrays
 * @param {PublicKey} programId - The program ID
 * @returns {Uint8Array} The derived address seed
 */
export const deriveAddressSeed = (
  seeds: Uint8Array[],
  programId: PublicKey
) => {
  const inputs: Uint8Array[] = [programId.toBytes(), ...seeds];

  const hash = hashvToBn254FieldSizeBe(inputs);
  return hash;
};

/**
 * Packs compressed accounts with input, output, and new address parameters.
 * @param {CompressedAccountWithMerkleContext[]} inputCompressedAccounts - Input compressed accounts
 * @param {CompressedAccount[]} outputCompressedAccounts - Output compressed accounts
 * @param {NewAddressParams[]} newAddressesParams - New address parameters
 * @param {CompressedProofWithContext} proof - Compressed proof with context
 * @returns {Object} Packed data including merkle contexts and remaining accounts
 */
export const packWithInput = (
  inputCompressedAccounts: CompressedAccountWithMerkleContext[],
  outputCompressedAccounts: CompressedAccount[],
  newAddressesParams: NewAddressParams[],
  proof: CompressedProofWithContext
) => {
  const { addressTree, addressQueue } = defaultTestStateTreeAccounts();
  const {
    remainingAccounts: _remainingAccounts,
    packedInputCompressedAccounts,
  } = packCompressedAccounts(
    inputCompressedAccounts,
    proof.rootIndices,
    outputCompressedAccounts
  );
  const { newAddressParamsPacked, remainingAccounts } = packNewAddressParams(
    newAddressesParams,
    _remainingAccounts
  );

  let addressMerkleTreeAccountIndex: number,
    addressMerkleTreeRootIndex: number,
    addressQueueAccountIndex: number;

  try {
    ({
      addressMerkleTreeAccountIndex,
      addressMerkleTreeRootIndex,
      addressQueueAccountIndex,
    } = newAddressParamsPacked[0]);
  } catch {
    addressMerkleTreeRootIndex = packedInputCompressedAccounts[0].rootIndex;
    addressMerkleTreeAccountIndex = getIndexOrAdd(
      remainingAccounts,
      addressTree
    );
    addressQueueAccountIndex = getIndexOrAdd(remainingAccounts, addressQueue);
  }
  const merkleContext: PackedMerkleContext =
    packedInputCompressedAccounts[0].merkleContext;

  return {
    addressMerkleContext: {
      addressMerkleTreePubkeyIndex: addressMerkleTreeAccountIndex,
      addressQueuePubkeyIndex: addressQueueAccountIndex,
    },
    addressMerkleTreeRootIndex,
    merkleContext,
    remainingAccounts,
  };
};

/**
 * Packs new compressed accounts with output and new address parameters.
 * @param {CompressedAccount[]} outputCompressedAccounts - Output compressed accounts
 * @param {NewAddressParams[]} newAddressesParams - New address parameters
 * @param {CompressedProofWithContext} proof - Compressed proof with context
 * @returns {Object} Packed data including merkle contexts and remaining accounts
 */
export const packNew = (
  outputCompressedAccounts: CompressedAccount[],
  newAddressesParams: NewAddressParams[],
  proof: CompressedProofWithContext
) => {
  const { merkleTree, nullifierQueue } = defaultTestStateTreeAccounts();
  const { remainingAccounts: _remainingAccounts } = packCompressedAccounts(
    [],
    proof.rootIndices,
    outputCompressedAccounts,
    merkleTree
  );
  const { newAddressParamsPacked, remainingAccounts } = packNewAddressParams(
    newAddressesParams,
    _remainingAccounts
  );
  let merkleContext: PackedMerkleContext = {
    leafIndex: 0,
    merkleTreePubkeyIndex: getIndexOrAdd(remainingAccounts, merkleTree),
    nullifierQueuePubkeyIndex: getIndexOrAdd(remainingAccounts, nullifierQueue),
    queueIndex: null,
  };
  let {
    addressMerkleTreeAccountIndex,
    addressMerkleTreeRootIndex,
    addressQueueAccountIndex,
  } = newAddressParamsPacked[0];
  return {
    addressMerkleContext: {
      addressMerkleTreePubkeyIndex: addressMerkleTreeAccountIndex,
      addressQueuePubkeyIndex: addressQueueAccountIndex,
    },
    addressMerkleTreeRootIndex,
    merkleContext,
    remainingAccounts,
  };
};

/**
 * Gets new address parameters from an address seed and proof.
 * @param {Uint8Array} addressSeed - The address seed
 * @param {CompressedProofWithContext} proof - Compressed proof with context
 * @returns {NewAddressParams} New address parameters
 */
export const getNewAddressParams = (
  addressSeed: Uint8Array,
  proof: CompressedProofWithContext
) => {
  const addressParams: NewAddressParams = {
    seed: addressSeed,
    addressMerkleTreeRootIndex: proof.rootIndices[proof.rootIndices.length - 1],
    addressMerkleTreePubkey: proof.merkleTrees[proof.merkleTrees.length - 1],
    addressQueuePubkey: proof.nullifierQueues[proof.nullifierQueues.length - 1],
  };
  return addressParams;
};

/**
 * Builds, signs, and sends a transaction with the given instructions.
 * @param {TransactionInstruction[]} instructions - Array of transaction instructions
 * @param {Keypair} payer - The payer's keypair
 * @param {Rpc} connection - The RPC connection
 * @returns {Promise<string>} The transaction signature
 */
export const buildSignAndSendTransaction = async (
  instructions: TransactionInstruction[],
  payer: Keypair,
  connection: Rpc,
  lookupTableAccount?: AddressLookupTableAccount[],
  additionalSigners: Signer[] = []
) => {
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = buildAndSignTx(
    instructions,
    payer,
    blockhash,
    additionalSigners,
    lookupTableAccount
  );
  const txSignature = await sendAndConfirmTx(connection, tx, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  return txSignature;
};

/**
 * Formats an array of PublicKeys into an array of account metas.
 * @param {PublicKey[]} remainingAccounts - Array of PublicKeys to format
 * @returns {Array<{pubkey: PublicKey, isSigner: boolean, isWritable: boolean}>} Formatted account metas
 */
export const formatRemainingAccounts = (remainingAccounts: PublicKey[]) => {
  return remainingAccounts.map((account) => ({
    pubkey: account,
    isSigner: false,
    isWritable: true,
  }));
};
