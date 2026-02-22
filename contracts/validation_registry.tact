// SPDX-License-Identifier: MIT
//
// ValidationRegistry — time-bounded work validation with designated validators.
//
// Designed around TON's asynchronous actor model: a requester opens a
// validation slot by sending a single message, and only the designated
// validator address can close it.  Because TON settles internal messages
// within the same block, the full request → response lifecycle completes
// in seconds — fast enough for automated agent pipelines that need
// near-real-time quality signals.
//
// Every request has an on-chain TTL enforced by now().  After expiry,
// the validator can no longer respond, and anyone can trigger a
// CleanupExpiredValidation to delete the stale entry and free cells.
// On TON, where persistent storage incurs rent proportional to cell
// count, this explicit GC pattern keeps long-term costs predictable
// even under adversarial load (spam requests that are never answered).
//
// The response score is a uint8 in [0, 100], making it composable:
// downstream contracts or off-chain indexers can aggregate scores
// without parsing complex structures — just read one integer from
// the on-chain state via a getter.

import "./messages";

struct ValidationData {
    agentValidatorId: Int as uint64;
    agentServerId: Int as uint64;
    requester: Address;
    validatorAddress: Address;
    expiresAt: Int as uint64;
    responded: Bool;
    response: Int as uint8;
}

struct PendingVerification {
    dataHash: Int as uint256;
    agentValidatorId: Int as uint64;
    agentServerId: Int as uint64;
    requester: Address;
    validatorAddress: Address;
    expiresAt: Int as uint64;
}

contract ValidationRegistry {
    identityRegistry: Address;
    ttl: Int as uint64;
    verificationSeq: Int as uint64;
    requests: map<Int as uint256, ValidationData>;
    pendingVerifications: map<Int as uint64, PendingVerification>;
    pendingByDataHash: map<Int as uint256, Int as uint64>;

    init(identityRegistry: Address, ttl: Int) {
        require(identityRegistry != newAddress(0, 0), "Invalid registry address");
        require(ttl > 0, "TTL must be positive");
        self.identityRegistry = identityRegistry;
        self.ttl = ttl;
        self.verificationSeq = 0;
    }

    receive() {
        cashback(sender());
    }

    receive(msg: RequestValidation) {
        let existing: ValidationData? = self.requests.get(msg.dataHash);
        require(existing == null, "Already requested");
        require(msg.validatorAddress != newAddress(0, 0), "Invalid validator address");
        let pendingQuery: Int? = self.pendingByDataHash.get(msg.dataHash);
        require(pendingQuery == null, "Verification pending");

        self.verificationSeq += 1;
        let queryId: Int = self.verificationSeq;
        let expiresAt: Int = now() + self.ttl;

        self.pendingVerifications.set(queryId, PendingVerification{
            dataHash: msg.dataHash,
            agentValidatorId: msg.agentValidatorId,
            agentServerId: msg.agentServerId,
            requester: sender(),
            validatorAddress: msg.validatorAddress,
            expiresAt: expiresAt,
        });
        self.pendingByDataHash.set(msg.dataHash, queryId);

        send(SendParameters{
            to: self.identityRegistry,
            value: 0,
            mode: SendRemainingValue | SendIgnoreErrors,
            body: VerifyAgent{
                agentId: msg.agentValidatorId,
                queryId: queryId,
            }.toCell(),
        });
    }

    // Callback from identity registry. If verification passes, request becomes active.
    receive(msg: VerifyAgentResponse) {
        require(sender() == self.identityRegistry, "Unauthorized");

        let pending: PendingVerification? = self.pendingVerifications.get(msg.queryId);
        if (pending == null) {
            return;
        }
        let pv: PendingVerification = pending!!;
        self.pendingVerifications.del(msg.queryId);
        self.pendingByDataHash.del(pv.dataHash);

        if (msg.verified &&
            msg.agentId == pv.agentValidatorId &&
            msg.agentAddress == pv.validatorAddress) {
            self.requests.set(pv.dataHash, ValidationData{
                agentValidatorId: pv.agentValidatorId,
                agentServerId: pv.agentServerId,
                requester: pv.requester,
                validatorAddress: pv.validatorAddress,
                expiresAt: pv.expiresAt,
                responded: false,
                response: 0,
            });
        }
    }

    // Only the verified designated validator address may respond.
    receive(msg: RespondValidation) {
        let req: ValidationData? = self.requests.get(msg.dataHash);
        require(req != null, "Request not found");
        let request: ValidationData = req!!;

        require(!request.responded, "Already responded");
        require(now() <= request.expiresAt, "Request expired");
        require(sender() == request.validatorAddress, "Unauthorized validator");
        require(msg.response <= 100, "Invalid response value");

        self.requests.set(msg.dataHash, ValidationData{
            agentValidatorId: request.agentValidatorId,
            agentServerId: request.agentServerId,
            requester: request.requester,
            validatorAddress: request.validatorAddress,
            expiresAt: request.expiresAt,
            responded: true,
            response: msg.response,
        });

        cashback(sender());
    }

    // Reclaims storage from expired unresponded requests.
    receive(msg: CleanupExpiredValidation) {
        let req: ValidationData? = self.requests.get(msg.dataHash);
        if (req != null) {
            let request: ValidationData = req!!;
            require(now() > request.expiresAt, "Request not yet expired");
            require(!request.responded, "Already responded, cannot cleanup");
            self.requests.del(msg.dataHash);
            cashback(sender());
            return;
        }

        let pendingQuery: Int? = self.pendingByDataHash.get(msg.dataHash);
        require(pendingQuery != null, "Request not found");
        let pending: PendingVerification? = self.pendingVerifications.get(pendingQuery!!);
        require(pending != null, "Request not found");
        let pv: PendingVerification = pending!!;
        require(now() > pv.expiresAt, "Request not yet expired");

        self.pendingVerifications.del(pendingQuery!!);
        self.pendingByDataHash.del(msg.dataHash);
        cashback(sender());
    }

    get fun getValidation(dataHash: Int): ValidationData? {
        return self.requests.get(dataHash);
    }

    get fun ttlValue(): Int {
        return self.ttl;
    }
}
