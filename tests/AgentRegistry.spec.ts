import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { AgentRegistry } from '../build/AgentRegistry/tact_AgentRegistry';
import '@ton/test-utils';

describe('AgentRegistry', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let registry: SandboxContract<AgentRegistry>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        registry = blockchain.openContract(await AgentRegistry.fromInit());

        const deployResult = await registry.send(
            deployer.getSender(), { value: toNano('0.05') }, null,
        );
        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address, to: registry.address, deploy: true, success: true,
        });
    });

    it('deploys with zero agents', async () => {
        expect(await registry.getAgentCount()).toBe(0n);
    });

    it('registers sender as the agent', async () => {
        const agent = await blockchain.treasury('agent1');

        await registry.send(agent.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });

        expect(await registry.getAgentCount()).toBe(1n);
        expect((await registry.getGetAgent(1n))!.toString()).toBe(agent.address.toString());
        expect((await registry.getGetAgentOwner(1n))!.toString()).toBe(agent.address.toString());
        expect(await registry.getGetAgentByAddress(agent.address)).toBe(1n);
    });

    it('registers multiple distinct agents', async () => {
        const agents = await Promise.all(['a1', 'a2', 'a3'].map(n => blockchain.treasury(n)));

        for (const a of agents) {
            await registry.send(a.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });
        }

        expect(await registry.getAgentCount()).toBe(3n);
        for (let i = 0; i < agents.length; i++) {
            expect((await registry.getGetAgent(BigInt(i + 1)))!.toString()).toBe(agents[i].address.toString());
        }
    });

    it('rejects duplicate address registration', async () => {
        const agent = await blockchain.treasury('agent1');
        await registry.send(agent.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });

        const dup = await registry.send(agent.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });
        expect(dup.transactions).toHaveTransaction({ from: agent.address, to: registry.address, success: false });
        expect(await registry.getAgentCount()).toBe(1n);
    });

    it('transfers identity to a new address', async () => {
        const agent = await blockchain.treasury('agent1');
        const next = await blockchain.treasury('next');

        await registry.send(agent.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });
        await registry.send(
            agent.getSender(), { value: toNano('0.05') },
            { $$type: 'UpdateAgentAddress', agentId: 1n, newAddress: next.address },
        );

        expect((await registry.getGetAgent(1n))!.toString()).toBe(next.address.toString());
        expect((await registry.getGetAgentOwner(1n))!.toString()).toBe(next.address.toString());
        expect(await registry.getGetAgentByAddress(agent.address)).toBeNull();
        expect(await registry.getGetAgentByAddress(next.address)).toBe(1n);
    });

    it('rejects update from non-owner', async () => {
        const agent = await blockchain.treasury('agent1');
        const attacker = await blockchain.treasury('attacker');

        await registry.send(agent.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });

        const r = await registry.send(
            attacker.getSender(), { value: toNano('0.05') },
            { $$type: 'UpdateAgentAddress', agentId: 1n, newAddress: attacker.address },
        );
        expect(r.transactions).toHaveTransaction({ from: attacker.address, to: registry.address, success: false });
        expect((await registry.getGetAgent(1n))!.toString()).toBe(agent.address.toString());
    });

    it('rejects update to already-registered address', async () => {
        const a1 = await blockchain.treasury('a1');
        const a2 = await blockchain.treasury('a2');

        await registry.send(a1.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });
        await registry.send(a2.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });

        const r = await registry.send(
            a1.getSender(), { value: toNano('0.05') },
            { $$type: 'UpdateAgentAddress', agentId: 1n, newAddress: a2.address },
        );
        expect(r.transactions).toHaveTransaction({ from: a1.address, to: registry.address, success: false });
    });

    it('rejects update for non-existent agent', async () => {
        const r = await registry.send(
            deployer.getSender(), { value: toNano('0.05') },
            { $$type: 'UpdateAgentAddress', agentId: 999n, newAddress: deployer.address },
        );
        expect(r.transactions).toHaveTransaction({ from: deployer.address, to: registry.address, success: false });
    });

    it('returns null for non-existent agent', async () => {
        expect(await registry.getGetAgent(999n)).toBeNull();
        expect(await registry.getGetAgentOwner(999n)).toBeNull();
    });

    it('returns null for unregistered address lookup', async () => {
        expect(await registry.getGetAgentByAddress(deployer.address)).toBeNull();
    });

    it('responds verified=true for existing agent', async () => {
        const agent = await blockchain.treasury('agent1');
        const caller = await blockchain.treasury('caller');

        await registry.send(agent.getSender(), { value: toNano('0.05') }, { $$type: 'RegisterAgent' });

        const r = await registry.send(
            caller.getSender(), { value: toNano('0.05') },
            { $$type: 'VerifyAgent', agentId: 1n, queryId: 42n },
        );
        expect(r.transactions).toHaveTransaction({ from: registry.address, to: caller.address, success: true });
    });

    it('responds verified=false for non-existent agent', async () => {
        const caller = await blockchain.treasury('caller');

        const r = await registry.send(
            caller.getSender(), { value: toNano('0.05') },
            { $$type: 'VerifyAgent', agentId: 999n, queryId: 1n },
        );
        expect(r.transactions).toHaveTransaction({ from: registry.address, to: caller.address, success: true });
    });
});
