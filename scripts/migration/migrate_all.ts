import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { getReleasesFromV1, initHelper, migrateReleaseFromV1ToV2, validateEnvironment, validateMigration } from "./helpers";
import { NinaV2 } from "../../target/types/nina_v2";


let AMOUNT_TO_MIGRATE: number = parseInt(process.argv[2]);
if (!AMOUNT_TO_MIGRATE) {
  AMOUNT_TO_MIGRATE = 100000;
}

const main = async () => {
  try {
    console.log('Starting migration run - Amount to migrate:', AMOUNT_TO_MIGRATE);
    validateEnvironment();

    const connection = new anchor.web3.Connection(process.env.NINA_RPC_ENDPOINT);
    const provider = new anchor.AnchorProvider(connection, anchor.Wallet.local(), anchor.AnchorProvider.defaultOptions());
    anchor.setProvider(provider);
    const program = anchor.workspace.NinaV2 as Program<NinaV2>;

    const programIdV1 = new anchor.web3.PublicKey(process.env.NINA_V1_PROGRAM_ID);
    await initHelper(programIdV1, program.programId);

    const releases = await getReleasesFromV1(AMOUNT_TO_MIGRATE, program, 0, 0);
    if (releases.length === 0) {
      console.log('No releases found to migrate');
      process.exit(1);
    }
    let amountMigrated = 0
    for (const release of releases) {
      console.log('Migrating release:', release.publicKey);
      const { v2Release, v1ReleasePublicKey, txid } = await migrateReleaseFromV1ToV2(release, program, provider, connection);
      const isValid = await validateMigration(release, txid, program, connection);
      if (!isValid) {
        throw new Error('Migration unsuccessful - validation failed');
      }
      amountMigrated++;
      console.log('Migration successful: v1ReleasePublicKey', v1ReleasePublicKey.toString(), '-> v2Release', v2Release.toString(), '\ntxid:', txid);
    }
    console.log('Migration Run Complete - Amount migrated:', amountMigrated);
  } catch (error) {
    console.log('error', error);
    throw new Error(error);
  }
}

main();