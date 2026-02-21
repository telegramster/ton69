import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { ValidationRegistry } from '../build/ValidationRegistry/tact_ValidationRegistry';
import '@ton/test-utils';

describe('ValidationRegistry', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let registry: SandboxContract<ValidationRegistry>;
    let validator: SandboxContract<TreasuryContract>;
    const TTL = 3600n;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        validator = await blockchain.treasury('validator');

        registry = blockchain.openContract(await ValidationRegistry.fromInit(deployer.address, TTL));
        const dr = await registry.send(deployer.getSender(), { value: toNano('0.05') }, null);
        expect(dr.transactions).toHaveTransaction({
            from: deployer.address, to: registry.address, deploy: true, success: true,
        });
    });

    it('deploys with correct TTL', async () => {
        expect(await registry.getTtlValue()).toBe(TTL);
    });

    it('creates a validation request with designated validator', async () => {
        const req = await blockchain.treasury('req');
        const dh = 123456789n;

        await registry.send(
            req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address },
        );

        const v = await registry.getGetValidation(dh);
        expect(v).not.toBeNull();
        expect(v!.agentValidatorId).toBe(1n);
        expect(v!.responded).toBe(false);
        expect(v!.validatorAddress.toString()).toBe(validator.address.toString());
    });

    it('rejects duplicate dataHash', async () => {
        const req = await blockchain.treasury('req');
        const dh = 111n;
        const msg = { $$type: 'RequestValidation' as const, agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address };

        await registry.send(req.getSender(), { value: toNano('0.05') }, msg);
        const r = await registry.send(req.getSender(), { value: toNano('0.05') }, msg);
        expect(r.transactions).toHaveTransaction({ from: req.address, to: registry.address, success: false });
    });

    it('accepts response from designated validator', async () => {
        const req = await blockchain.treasury('req');
        const dh = 222n;

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address });

        await registry.send(validator.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: dh, response: 85n });

        const v = await registry.getGetValidation(dh);
        expect(v!.responded).toBe(true);
        expect(v!.response).toBe(85n);
    });

    it('rejects response from non-designated address', async () => {
        const req = await blockchain.treasury('req');
        const attacker = await blockchain.treasury('attacker');
        const dh = 333n;

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address });

        const r = await registry.send(attacker.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: dh, response: 50n });

        expect(r.transactions).toHaveTransaction({ from: attacker.address, to: registry.address, success: false });
        expect((await registry.getGetValidation(dh))!.responded).toBe(false);
    });

    it('rejects score > 100', async () => {
        const req = await blockchain.treasury('req');
        const dh = 444n;

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address });

        const r = await registry.send(validator.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: dh, response: 101n });
        expect(r.transactions).toHaveTransaction({ from: validator.address, to: registry.address, success: false });
    });

    it('rejects duplicate response', async () => {
        const req = await blockchain.treasury('req');
        const dh = 555n;

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address });
        await registry.send(validator.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: dh, response: 90n });

        const r = await registry.send(validator.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: dh, response: 50n });
        expect(r.transactions).toHaveTransaction({ from: validator.address, to: registry.address, success: false });
        expect((await registry.getGetValidation(dh))!.response).toBe(90n);
    });

    it('rejects response for non-existent request', async () => {
        const r = await registry.send(validator.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: 999999n, response: 50n });
        expect(r.transactions).toHaveTransaction({ from: validator.address, to: registry.address, success: false });
    });

    it('accepts boundary scores 0 and 100', async () => {
        const req = await blockchain.treasury('req');

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: 1000n, validatorAddress: validator.address });
        await registry.send(validator.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: 1000n, response: 0n });
        expect((await registry.getGetValidation(1000n))!.response).toBe(0n);

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 3n, agentServerId: 4n, dataHash: 2000n, validatorAddress: validator.address });
        await registry.send(validator.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: 2000n, response: 100n });
        expect((await registry.getGetValidation(2000n))!.response).toBe(100n);
    });

    it('rejects response after TTL', async () => {
        const req = await blockchain.treasury('req');
        const dh = 666n;

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address });

        blockchain.now = Math.floor(Date.now() / 1000) + 3601;

        const r = await registry.send(validator.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: dh, response: 80n });
        expect(r.transactions).toHaveTransaction({ from: validator.address, to: registry.address, success: false });
    });

    it('cleans up expired unresponded request', async () => {
        const req = await blockchain.treasury('req');
        const dh = 777n;

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address });

        blockchain.now = Math.floor(Date.now() / 1000) + 3601;

        const cleaner = await blockchain.treasury('cleaner');
        const r = await registry.send(cleaner.getSender(), { value: toNano('0.05') },
            { $$type: 'CleanupExpiredValidation', dataHash: dh });
        expect(r.transactions).toHaveTransaction({ from: cleaner.address, to: registry.address, success: true });
        expect(await registry.getGetValidation(dh)).toBeNull();
    });

    it('rejects cleanup of non-expired request', async () => {
        const req = await blockchain.treasury('req');
        const dh = 888n;

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address });

        const r = await registry.send(deployer.getSender(), { value: toNano('0.05') },
            { $$type: 'CleanupExpiredValidation', dataHash: dh });
        expect(r.transactions).toHaveTransaction({ from: deployer.address, to: registry.address, success: false });
    });

    it('rejects cleanup of already-responded request', async () => {
        const req = await blockchain.treasury('req');
        const dh = 999n;

        await registry.send(req.getSender(), { value: toNano('0.05') },
            { $$type: 'RequestValidation', agentValidatorId: 1n, agentServerId: 2n, dataHash: dh, validatorAddress: validator.address });
        await registry.send(validator.getSender(), { value: toNano('0.05') },
            { $$type: 'RespondValidation', dataHash: dh, response: 75n });

        blockchain.now = Math.floor(Date.now() / 1000) + 3601;

        const r = await registry.send(deployer.getSender(), { value: toNano('0.05') },
            { $$type: 'CleanupExpiredValidation', dataHash: dh });
        expect(r.transactions).toHaveTransaction({ from: deployer.address, to: registry.address, success: false });
    });

    it('rejects cleanup of non-existent request', async () => {
        const r = await registry.send(deployer.getSender(), { value: toNano('0.05') },
            { $$type: 'CleanupExpiredValidation', dataHash: 12345n });
        expect(r.transactions).toHaveTransaction({ from: deployer.address, to: registry.address, success: false });
    });

    it('returns null for non-existent validation', async () => {
        expect(await registry.getGetValidation(12345n)).toBeNull();
    });
});
