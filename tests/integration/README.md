# Native integration tests

`npm run test:db` is destructive only to the configured database: its setup
migrates the schema and truncates application tables between tests. The preload
loads local environment values, validates `DATABASE_URL` and requires the
explicit opt-in `ALLOW_DESTRUCTIVE_TEST_DB=1` before any application database
module can construct a pool. The target must be a dedicated disposable database
whose name ends in `_test`; remote hosts are refused by default.

CI uses isolated MariaDB services and sets the opt-in only for this job. For a
local run, create a disposable MariaDB database such as `content_machine_test`,
then set its URL and opt-in in the current shell:

```sh
DATABASE_URL='mysql://test_user:password@127.0.0.1:3306/content_machine_test' \
ALLOW_DESTRUCTIVE_TEST_DB=1 npm run test:db
```

PowerShell:

```powershell
$env:DATABASE_URL = 'mysql://test_user:password@127.0.0.1:3306/content_machine_test'
$env:ALLOW_DESTRUCTIVE_TEST_DB = '1'
npm run test:db
```

Never use an operational database URL, even if it has a `_test` name. The
hostname guard is an additional boundary, not proof that a database is safe.
Do not copy production records into test databases. The tests use synthetic
rows and mocked external providers.
