import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  getReleasesFromV1,
  initHelper,
  migrateReleaseFromV1ToV2,
  validateEnvironment,
  validateMigration,
} from "./helpers";
import { NinaV2 } from "../../target/types/nina_v2";

const AMOUNT_TO_MIGRATE: number = parseInt(process.argv[2] || "", 10) || 20000;
const CONCURRENCY: number = parseInt(process.argv[3] || "", 10) || 5;

const main = async () => {
  try {
    console.log("Starting migration run");
    console.log("  Amount to migrate:", AMOUNT_TO_MIGRATE);
    console.log("  Concurrency:", CONCURRENCY);

    validateEnvironment();

    const connection = new anchor.web3.Connection(
      process.env.NINA_RPC_ENDPOINT as string
    );
    const provider = new anchor.AnchorProvider(
      connection,
      anchor.Wallet.local(),
      anchor.AnchorProvider.defaultOptions()
    );
    anchor.setProvider(provider);
    const program = anchor.workspace.NinaV2 as Program<NinaV2>;

    const programIdV1 = new anchor.web3.PublicKey(
      process.env.NINA_V1_PROGRAM_ID as string
    );
    await initHelper(programIdV1, program.programId);

    const releases = await getReleasesFromV1(AMOUNT_TO_MIGRATE, program, 0, 0);
    console.log('getReleasesFromV1 releases', releases.length);
    if (releases.length === 0) {
      console.log("No releases found to migrate");
      process.exit(1);
    }

    let amountMigrated = 0;
    let currentIndex = 0;
    let abort = false;
    let fatalError: Error | null = null;

    const total = releases.length;
    console.log("Total releases fetched:", total);
    const getNextRelease = () => {
      console.log("Getting next release");
      console.log("abort", abort);
      console.log("currentIndex", currentIndex);
      console.log("total", total);
      if (abort) return null;
      if (currentIndex >= total) return null;
      const r = releases[currentIndex];
      console.log(
        `Assigning release index ${currentIndex} / ${total - 1} to worker`
      );
      currentIndex += 1;
      return r;
    };

    const migrateOne = async (release: any) => {
      console.log("Migrating release:", release.publicKey);

      const { v2Release, v1ReleasePublicKey, txid } =
        await migrateReleaseFromV1ToV2(release, program, provider, connection);

      const isValid = await validateMigration(
        release,
        txid,
        program,
        connection
      );
      if (!isValid) {
        console.error(
          "Migration unsuccessful - validation failed for release:",
          release.publicKey.toString(),
          "txid:",
          txid
        );
        // IMPORTANT: throw here; the worker catch will set abort + fatalError
        throw new Error(
          `Migration validation failed for ${release.publicKey.toString()}`
        );
      }

      amountMigrated++;
      console.log(
        "Migration successful:",
        "\nv1ReleasePublicKey",
        v1ReleasePublicKey.toString(),
        "-> v2Release",
        v2Release.toString(),
        "\ntxid:",
        txid
      );
    };

    // Worker function: pulls from releases until none left or abort is set
    const worker = async (workerId: number) => {
      console.log(`Worker ${workerId} starting`);
      while (true) {
        if (abort) {
          console.log(`Worker ${workerId} aborting (abort flag set)`);
          return;
        }

        const release = getNextRelease();
        if (!release) {
          console.log(`Worker ${workerId} found no more work, exiting`);
          return;
        }

        try {
          await migrateOne(release);
        } catch (err: any) {
          console.error(`Worker ${workerId} encountered an error`, err);
          // Set abort flag so other workers stop pulling new work
          abort = true;
          // remember the first fatal error
          if (!fatalError) {
            fatalError = err instanceof Error ? err : new Error(String(err));
          }
          // stop this worker
          return;
        }
      }
    };

    const workerCount = Math.min(CONCURRENCY, releases.length);
    console.log("Spawning workers:", workerCount);

    await Promise.all(
      Array.from({ length: workerCount }, (_, i) => worker(i))
    );

    console.log("Migration Run Complete - Amount migrated:", amountMigrated);

    if (fatalError) {
      console.error("Migration run finished with errors:", fatalError.message);
      process.exit(1);
    }
  } catch (error: any) {
    console.error("Migration run failed:", error?.message || error);
    process.exit(1);
  }
};

main();