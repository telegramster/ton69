import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { AgentRegistry } from '../build/AgentRegistry/tact_AgentRegistry';
import { ReputationRegistry } from '../build/ReputationRegistry/tact_ReputationRegistry';
import '@ton/test-utils';

describe('ReputationRegistry', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let agentRegistry: SandboxContract<AgentRegistry>;
    let repRegistry: SandboxContract<ReputationRegistry>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        agentRegistry = blockchain.openContract(await AgentRegistry.fromInit());
        await agentRegistry.send(deployer.getSender(), { value: toNano('0.05') }, null);

        repRegistry = blockchain.openContract(await ReputationRegistry.fromInit(agentRegistry.address));
        const dr = await repRegistry.send(deployer.getSender(), { value: toNano('0.05') }, null);
        expect(dr.transactions).toHaveTransaction({
            from: deployer.address, to: repRegistry.address, deploy: true, success: true,
        });
    });

    it('deploys with correct initial state', async () => {
        expect((await repRegistry.getIdentityRegistryAddress()).toString()).toBe(agentRegistry.address.toString());
        expect(await repRegistry.getFeedbackCount()).toBe(0n);
        expect(await repRegistry.getAuthorizedCount()).toBe(0n);
    });

    it('authorizes feedback for a verified agent (full round-trip)', async () => {
        const server = await blockchain.treasury('server');
        await agentRegistry.send(server.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });

        const r = await repRegistry.send(
            server.getSender(), { value: toNano('0.1') },
            { $$type: 'AcceptFeedback', agentClientId: 2n, agentServerId: 1n },
        );

        expect(r.transactions).toHaveTransaction({ from: server.address, to: repRegistry.address, success: true });
        expect(r.transactions).toHaveTransaction({ from: repRegistry.address, to: agentRegistry.address, success: true });
        expect(r.transactions).toHaveTransaction({ from: agentRegistry.address, to: repRegistry.address, success: true });

        expect(await repRegistry.getFeedbackCount()).toBe(1n);
        expect(await repRegistry.getAuthorizedCount()).toBe(1n);
    });

    it('gracefully rejects impostor and cleans pending', async () => {
        const real = await blockchain.treasury('real');
        const fake = await blockchain.treasury('fake');

        await agentRegistry.send(real.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });

        const r = await repRegistry.send(
            fake.getSender(), { value: toNano('0.1') },
            { $$type: 'AcceptFeedback', agentClientId: 2n, agentServerId: 1n },
        );

        // callback succeeds but authorization is denied
        expect(r.transactions).toHaveTransaction({
            from: agentRegistry.address, to: repRegistry.address, success: true,
        });
        expect(await repRegistry.getAuthorizedCount()).toBe(0n);
    });

    it('gracefully rejects non-existent agent and cleans pending', async () => {
        const user = await blockchain.treasury('user');

        await repRegistry.send(
            user.getSender(), { value: toNano('0.1') },
            { $$type: 'AcceptFeedback', agentClientId: 1n, agentServerId: 999n },
        );

        expect(await repRegistry.getAuthorizedCount()).toBe(0n);
    });

    it('rejects VerifyAgentResponse from unauthorized sender', async () => {
        const attacker = await blockchain.treasury('attacker');

        const r = await repRegistry.send(
            attacker.getSender(), { value: toNano('0.05') },
            { $$type: 'VerifyAgentResponse', agentId: 1n, queryId: 1n, verified: true, agentAddress: attacker.address },
        );
        expect(r.transactions).toHaveTransaction({ from: attacker.address, to: repRegistry.address, success: false });
    });

    it('handles multiple independent authorizations', async () => {
        const s1 = await blockchain.treasury('s1');
        const s2 = await blockchain.treasury('s2');

        await agentRegistry.send(s1.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });
        await agentRegistry.send(s2.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });

        await repRegistry.send(s1.getSender(), { value: toNano('0.1') }, { $$type: 'AcceptFeedback', agentClientId: 10n, agentServerId: 1n });
        await repRegistry.send(s2.getSender(), { value: toNano('0.1') }, { $$type: 'AcceptFeedback', agentClientId: 10n, agentServerId: 2n });

        expect(await repRegistry.getFeedbackCount()).toBe(2n);
        expect(await repRegistry.getAuthorizedCount()).toBe(2n);
    });

    it('rejects cleanup for non-existent pending entry', async () => {
        const user = await blockchain.treasury('user');
        const r = await repRegistry.send(
            user.getSender(), { value: toNano('0.05') },
            { $$type: 'CleanupPendingFeedback', queryId: 999n },
        );
        expect(r.transactions).toHaveTransaction({ from: user.address, to: repRegistry.address, success: false });
    });
});
