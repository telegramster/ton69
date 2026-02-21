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

contract ValidationRegistry {
    identityRegistry: Address;
    ttl: Int as uint64;
    requests: map<Int as uint256, ValidationData>;

    init(identityRegistry: Address, ttl: Int) {
        require(identityRegistry != newAddress(0, 0), "Invalid registry address");
        require(ttl > 0, "TTL must be positive");
        self.identityRegistry = identityRegistry;
        self.ttl = ttl;
    }

    receive() {
        cashback(sender());
    }

    receive(msg: RequestValidation) {
        let existing: ValidationData? = self.requests.get(msg.dataHash);
        require(existing == null, "Already requested");

        self.requests.set(msg.dataHash, ValidationData{
            agentValidatorId: msg.agentValidatorId,
            agentServerId: msg.agentServerId,
            requester: sender(),
            validatorAddress: msg.validatorAddress,
            expiresAt: now() + self.ttl,
            responded: false,
            response: 0,
        });

        cashback(sender());
    }

    // Only the address designated at request time may respond.
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
        require(req != null, "Request not found");
        let request: ValidationData = req!!;
        require(now() > request.expiresAt, "Request not yet expired");
        require(!request.responded, "Already responded, cannot cleanup");

        self.requests.del(msg.dataHash);
        cashback(sender());
    }

    get fun getValidation(dataHash: Int): ValidationData? {
        return self.requests.get(dataHash);
    }

    get fun ttlValue(): Int {
        return self.ttl;
    }
}
