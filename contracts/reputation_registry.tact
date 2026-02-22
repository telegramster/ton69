// SPDX-License-Identifier: MIT
//
// ReputationRegistry — on-chain feedback authorization for agent interactions.
//
// Leverages TON's native async messaging to perform cross-contract
// identity verification without blocking or external oracles.
// The full round-trip (AcceptFeedback → VerifyAgent → callback)
// settles within a single block on TON's ~5s finality, which is
// fast enough for real-time agent-to-agent reputation signaling.
//
// The callback handler is intentionally non-reverting: it uses
// conditional logic instead of require() for verification results,
// so the pending entry is always deleted regardless of outcome.
// On TON, where every cell in persistent storage costs rent,
// this prevents a DoS vector where an attacker floods the contract
// with unresolvable entries that accumulate storage fees forever.
//
// A TTL-based cleanup receiver lets anyone garbage-collect stale
// pending entries whose verification message was lost (e.g. due to
// insufficient gas on the outbound hop).  The caller pays for the
// cleanup compute and gets a cashback of unused gas — an incentive
// pattern native to TON's gas model.

import "./messages";

struct PendingFeedback {
    agentClientId: Int as uint64;
    agentServerId: Int as uint64;
    originalSender: Address;
    createdAt: Int as uint64;
}

contract ReputationRegistry {
    const PendingTtl: Int = 3600;

    identityRegistry: Address;
    feedbackCount: Int as uint64;
    authorizedCount: Int as uint64;
    pendingFeedbacks: map<Int as uint64, PendingFeedback>;
    authorizedPairs: map<Int as uint128, Bool>;

    init(identityRegistry: Address) {
        require(identityRegistry != newAddress(0, 0), "Invalid registry address");
        self.identityRegistry = identityRegistry;
        self.feedbackCount = 0;
        self.authorizedCount = 0;
    }

    receive() {
        cashback(sender());
    }

    // Stores a pending entry and forwards a VerifyAgent request to the identity registry.
    receive(msg: AcceptFeedback) {
        self.feedbackCount += 1;
        let queryId: Int = self.feedbackCount;

        self.pendingFeedbacks.set(queryId, PendingFeedback{
            agentClientId: msg.agentClientId,
            agentServerId: msg.agentServerId,
            originalSender: sender(),
            createdAt: now(),
        });

        send(SendParameters{
            to: self.identityRegistry,
            value: 0,
            mode: SendRemainingValue | SendIgnoreErrors,
            body: VerifyAgent{
                agentId: msg.agentServerId,
                queryId: queryId,
            }.toCell(),
        });
    }

    // Callback from identity registry.  Always cleans the pending entry to prevent
    // unbounded storage growth; authorizes only when the sender matches on-chain data.
    receive(msg: VerifyAgentResponse) {
        require(sender() == self.identityRegistry, "Unauthorized");

        let pending: PendingFeedback? = self.pendingFeedbacks.get(msg.queryId);
        if (pending == null) {
            return;
        }
        let pf: PendingFeedback = pending!!;

        self.pendingFeedbacks.del(msg.queryId);

        if (msg.verified &&
            msg.agentId == pf.agentServerId &&
            msg.agentAddress == pf.originalSender) {
            let key: Int = (pf.agentClientId << 64) + pf.agentServerId;
            let alreadyAuthorized: Bool? = self.authorizedPairs.get(key);
            if (alreadyAuthorized == null) {
                self.authorizedPairs.set(key, true);
                self.authorizedCount += 1;
            }
        }
    }

    // Lets anyone reclaim storage from stale pending entries that were never resolved.
    receive(msg: CleanupPendingFeedback) {
        let pending: PendingFeedback? = self.pendingFeedbacks.get(msg.queryId);
        require(pending != null, "No pending feedback");
        let pf: PendingFeedback = pending!!;
        require(now() > pf.createdAt + self.PendingTtl, "Not yet expired");

        self.pendingFeedbacks.del(msg.queryId);
        cashback(sender());
    }

    get fun identityRegistryAddress(): Address {
        return self.identityRegistry;
    }

    get fun feedbackCount(): Int {
        return self.feedbackCount;
    }

    get fun authorizedCount(): Int {
        return self.authorizedCount;
    }
}
