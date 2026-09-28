import { config, loadKey } from './config.js';
import { openDatabase } from './database.js';
import { Accounts } from './accounts.js';

const settings = config();
if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535)
    throw new Error('NODE_PORT should be between 1024 and 65535');

const db = await openDatabase(settings.database);
try {
    const accounts = new Accounts(db, settings, loadKey(settings.privateDir));
    await accounts.initialize({ seedDefault: false });
    console.log(`SCHEMA_INITIALIZE_OK database=${settings.database} origin=${settings.origin}`);
} finally {
    await db.destroy();
}
