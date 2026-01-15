import { supabase } from '../supabase/supabaseClient.js';

/**
 * Check COA accounts for the test tenant
 */

async function checkTenantAccounts() {
    const tenantId = '7b44ea82-1571-4cbb-866b-d783f0fa6d70';

    console.log(`🔍 Checking COA for tenant: ${tenantId}\n`);

    try {
        const { data: accounts, error } = await supabase
            .from('coa')
            .select('id, name, type')
            .eq('tenant_id', tenantId)
            .order('id');

        if (error) {
            console.error('❌ Error:', error.message);
            return;
        }

        console.log('All COA accounts for this tenant:');
        console.log('┌──────┬────────────────────────┬────────────┐');
        console.log('│  ID  │ Account Name           │ Type       │');
        console.log('├──────┼────────────────────────┼────────────┤');

        accounts.forEach(acc => {
            const expectedType = getExpectedType(acc.name);
            const status = expectedType && acc.type !== expectedType ? ' ❌' : ' ✅';
            console.log(`│ ${String(acc.id).padEnd(4)} │ ${acc.name.padEnd(22)} │ ${acc.type.padEnd(10)} │${status}`);
        });

        console.log('└──────┴────────────────────────┴────────────┘\n');

        // Check specifically for Accounts Payable
        const apAccount = accounts.find(a => a.name.toLowerCase() === 'accounts payable');
        if (apAccount) {
            console.log('✅ Found "Accounts Payable":');
            console.log(`   ID: ${apAccount.id}`);
            console.log(`   Type: ${apAccount.type} ${apAccount.type === 'liability' ? '✅' : '❌'}`);
        } else {
            console.log('⚠️ "Accounts Payable" account not found for this tenant!');
        }

    } catch (err) {
        console.error('💥 Error:', err);
    }
}

function getExpectedType(name) {
    const expected = {
        'cash': 'asset',
        'bank': 'asset',
        'inventory': 'asset',
        'vat input': 'asset',
        'accounts receivable': 'asset',
        'accounts payable': 'liability',
        'vat payable': 'liability',
        'vat output': 'liability',
        'sales': 'income',
        'cost of goods sold': 'expense',
        'cogs': 'expense'
    };
    return expected[name.toLowerCase()];
}

checkTenantAccounts()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
