import "dotenv/config.js";
import * as anchor from "@coral-xyz/anchor";
import {
  initHelper,
  migrateReleaseFromV1ToV2,
  getReleasesFromV1,
  validateEnvironment,
  validateMigration,
} from "./helpers";
import { NinaV2 } from "../../target/types/nina_v2";
import { Program } from "@coral-xyz/anchor";

const main = async () => {
  try {
    validateEnvironment();

    const connection = new anchor.web3.Connection(process.env.NINA_RPC_ENDPOINT);
    const provider = new anchor.AnchorProvider(connection, anchor.Wallet.local(), anchor.AnchorProvider.defaultOptions());
    anchor.setProvider(provider);
    const program = anchor.workspace.NinaV2 as Program<NinaV2>;

    const programIdV1 = new anchor.web3.PublicKey(process.env.NINA_V1_PROGRAM_ID);
    await initHelper(programIdV1, program.programId);
    const releases = await getReleasesFromV1(1, program, 0, 0);
    if (releases.length === 0) {
      console.log('No releases found to migrate');
      process.exit(1);
    }
    const release = releases[0];
    console.log('Found a release to migrate:', release.publicKey);
    const { v2Release, v1ReleasePublicKey, txid } = await migrateReleaseFromV1ToV2(release, program, provider, connection);
    const isValid = await validateMigration(release, txid, program, connection);
    if (!isValid) {
      throw new Error('Migration unsuccessful - validation failed');
    }
    console.log('Migration successful: v1ReleasePublicKey', v1ReleasePublicKey.toString(), '-> v2Release', v2Release.toString(), '\ntxid:', txid);
  } catch (error) {
    console.log('Migration unsuccessful - error: ', error);
    throw new Error(error);
  }
};

main();