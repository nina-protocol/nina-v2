import "dotenv/config.js";
import * as anchor from "@coral-xyz/anchor";
import {
  initHelper,
  migrateReleaseFromV1ToV2,
  getReleaseFromV1ByPublicKey,
  validateEnvironment,
} from "./helpers";
import { NinaV2 } from "../../target/types/nina_v2";
import { Program } from "@coral-xyz/anchor";

const PUBLIC_KEY = process.argv[2];
if (!PUBLIC_KEY) {
  console.log('Usage: ts-node scripts/migration/migrate_single_release_by_public_key.ts <public_key>');
  process.exit(1);
}

const main = async () => {
  try {
    validateEnvironment();

    const connection = new anchor.web3.Connection(process.env.NINA_RPC_ENDPOINT);
    const provider = new anchor.AnchorProvider(connection, anchor.Wallet.local(), anchor.AnchorProvider.defaultOptions());
    anchor.setProvider(provider);
    const program = anchor.workspace.NinaV2 as Program<NinaV2>;

    const programIdV1 = new anchor.web3.PublicKey(process.env.NINA_V1_PROGRAM_ID);
    await initHelper(programIdV1, program.programId);

    const release = await getReleaseFromV1ByPublicKey(PUBLIC_KEY);
    const { v2Release, v1ReleasePublicKey } = await migrateReleaseFromV1ToV2(release, program, provider, connection);
    console.log('Migration successful: v1ReleasePublicKey', v1ReleasePublicKey.toString(), '-> v2Release', v2Release.toString());
  } catch (error) {
    console.log('error', error);
    throw new Error(error);
  }
}

main();