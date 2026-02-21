// SPDX-License-Identifier: MIT
//
// AgentRegistry — permissionless on-chain identity for autonomous agents.
//
// Built on TON's actor model: every agent is a first-class actor address,
// and identity is proven by the sender() primitive — no signatures,
// no oracles, no off-chain attestations.  The TVM guarantees that
// sender() is cryptographically authentic at the protocol level,
// which makes spoofing impossible without the private key.
//
// A reverse-lookup map (address → agentId) enforces 1:1 uniqueness
// and enables O(1) resolution in either direction.
//
// The VerifyAgent receiver turns this contract into a composable
// identity oracle: any contract on the network can send a verification
// request and get a callback response within the same logical transaction
// group — no bridges, no relayers, just native TON message routing.
//
// Because contract addresses on TON are deterministic (hash of code + data),
// the registry deploys to a predictable address and acts as a natural
// singleton without any governance or deploy-race conditions.
//
// Storage costs are bounded by TON's rent model — inactive entries
// naturally become candidates for off-chain archival, while the
// cashback() pattern returns unused gas to callers on every operation.

import "./messages";

contract AgentRegistry {
    nextAgentId: Int as uint64;
    agents: map<Int as uint64, Address>;
    agentOwners: map<Int as uint64, Address>;
    addressToAgent: map<Address, Int as uint64>;

    init() {
        self.nextAgentId = 0;
    }

    receive() {
        cashback(sender());
    }

    // Agent = sender(); one address can only hold one identity.
    receive(msg: RegisterAgent) {
        let existing: Int? = self.addressToAgent.get(sender());
        require(existing == null, "Address already registered");

        self.nextAgentId += 1;
        let agentId: Int = self.nextAgentId;

        self.agents.set(agentId, sender());
        self.agentOwners.set(agentId, sender());
        self.addressToAgent.set(sender(), agentId);

        cashback(sender());
    }

    // Transfers identity + ownership to a new address.
    receive(msg: UpdateAgentAddress) {
        let currentOwner: Address? = self.agentOwners.get(msg.agentId);
        require(currentOwner != null, "Agent not found");
        require(currentOwner!! == sender(), "Unauthorized");

        let conflict: Int? = self.addressToAgent.get(msg.newAddress);
        require(conflict == null, "New address already registered");

        let oldAddress: Address = self.agents.get(msg.agentId)!!;
        self.addressToAgent.del(oldAddress);

        self.agents.set(msg.agentId, msg.newAddress);
        self.agentOwners.set(msg.agentId, msg.newAddress);
        self.addressToAgent.set(msg.newAddress, msg.agentId);

        cashback(sender());
    }

    // On-chain identity oracle: any contract can verify an agent
    // via native message routing and get a response in the same tx group.
    receive(msg: VerifyAgent) {
        let agentAddr: Address? = self.agents.get(msg.agentId);
        let verified: Bool = agentAddr != null;
        let addr: Address = myAddress();
        if (verified) {
            addr = agentAddr!!;
        }
        send(SendParameters{
            to: sender(),
            value: 0,
            mode: SendRemainingValue | SendIgnoreErrors,
            body: VerifyAgentResponse{
                agentId: msg.agentId,
                queryId: msg.queryId,
                verified: verified,
                agentAddress: addr,
            }.toCell(),
        });
    }

    get fun agentCount(): Int {
        return self.nextAgentId;
    }

    get fun getAgent(agentId: Int): Address? {
        return self.agents.get(agentId);
    }

    get fun getAgentOwner(agentId: Int): Address? {
        return self.agentOwners.get(agentId);
    }

    get fun getAgentByAddress(addr: Address): Int? {
        return self.addressToAgent.get(addr);
    }
}
