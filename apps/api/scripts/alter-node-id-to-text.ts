// One-off: alter node_id columns from uuid → text in the global Postgres DB.
// Must drop FK constraints first, alter columns, then re-add FK constraints.
import pg from 'pg'

const url =
  process.env.SETUP_DATABASE_URL ??
  `postgres://${process.env.MANAGED_GLOBAL_DB_USER ?? 'deployer'}:${process.env.MANAGED_GLOBAL_DB_PASSWORD ?? 'deployer'}@${process.env.MANAGED_GLOBAL_DB_HOST ?? 'global-db'}:${process.env.MANAGED_GLOBAL_DB_PORT ?? '5432'}/${process.env.MANAGED_GLOBAL_DB_NAME ?? 'deployer'}`

const pool = new pg.Pool({ connectionString: url })

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Step 1: Drop all FK constraints that reference cluster_nodes.node_id
    console.log('Dropping FK constraints...')
    const fkConstraints = [
      ['cluster_admission_requests', 'cluster_admission_requests_requested_server_node_id_cluster_nod'],
      ['cluster_admission_requests', 'cluster_admission_requests_decision_server_node_id_cluster_node'],
      ['cluster_node_metrics', 'cluster_node_metrics_node_id_cluster_nodes_node_id_fk'],
      ['cluster_server_allocations', 'cluster_server_allocations_server_node_id_cluster_nodes_node_id'],
      ['resource_ownership_index', 'resource_ownership_index_owner_node_id_cluster_nodes_node_id_fk'],
      ['resource_ownership_index', 'resource_ownership_index_lease_holder_node_id_cluster_nodes_nod'],
    ]

    for (const [table, constraint] of fkConstraints) {
      try {
        await client.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`)
        console.log(`  Dropped FK: ${table}.${constraint}`)
      } catch (e: any) {
        console.log(`  FK ${constraint} not found (may have different name), skipping`)
      }
    }

    // Step 2: Alter all node_id columns from uuid to text
    console.log('\nAltering columns from uuid to text...')
    const alterations = [
      ['cluster_nodes', 'node_id'],
      ['cluster_admission_requests', 'requested_server_node_id'],
      ['cluster_admission_requests', 'decision_server_node_id'],
      ['cluster_node_metrics', 'node_id'],
      ['cluster_server_allocations', 'server_node_id'],
      ['resource_ownership_index', 'owner_node_id'],
      ['resource_ownership_index', 'lease_holder_node_id'],
      ['cluster_join_grants', 'target_node_id'],
      ['node_network_config', 'node_id'],
      ['local_queue_jobs', 'node_id'],
      ['local_runtime_processes', 'node_id'],
      ['local_build_cache', 'node_id'],
      ['local_event_outbox', 'node_id'],
    ]

    for (const [table, column] of alterations) {
      await client.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DATA TYPE text`)
      console.log(`  Altered: ${table}.${column} → text`)
    }

    // Step 3: Re-add FK constraints
    console.log('\nRe-adding FK constraints...')
    const fksToAdd = [
      ['cluster_admission_requests', 'requested_server_node_id', 'cluster_nodes', 'node_id'],
      ['cluster_admission_requests', 'decision_server_node_id', 'cluster_nodes', 'node_id'],
      ['cluster_node_metrics', 'node_id', 'cluster_nodes', 'node_id'],
      ['cluster_server_allocations', 'server_node_id', 'cluster_nodes', 'node_id'],
      ['resource_ownership_index', 'owner_node_id', 'cluster_nodes', 'node_id'],
      ['resource_ownership_index', 'lease_holder_node_id', 'cluster_nodes', 'node_id'],
    ]

    for (const [table, column, refTable, refColumn] of fksToAdd) {
      const fkName = `fk_${table}_${column}`
      await client.query(`ALTER TABLE "${table}" ADD CONSTRAINT "${fkName}" FOREIGN KEY ("${column}") REFERENCES "${refTable}"("${refColumn}") ON DELETE CASCADE`)
      console.log(`  Added FK: ${table}.${column} → ${refTable}.${refColumn}`)
    }

    await client.query('COMMIT')
    console.log('\n✅ All node_id columns altered from uuid to text successfully')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('❌ Migration failed, rolled back:', e)
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

run()
