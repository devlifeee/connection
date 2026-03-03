import { useQuery } from "@tanstack/react-query";
import { nodeAgentApi } from "@/api/nodeAgent";

export function useNodeAgentHealth() {
  return useQuery({
    queryKey: ["node-agent", "health"],
    queryFn: nodeAgentApi.health,
    retry: false,
    refetchInterval: 2000,
  });
}

export function useNodeAgentIdentity() {
  return useQuery({
    queryKey: ["node-agent", "identity"],
    queryFn: nodeAgentApi.identity,
    retry: false,
    refetchInterval: 5000,
  });
}

export function useNodeAgentPeers() {
  return useQuery({
    queryKey: ["node-agent", "peers"],
    queryFn: nodeAgentApi.peers,
    retry: false,
    refetchInterval: 2000,
  });
}

export function useNodeAgentPresence() {
  return useQuery({
    queryKey: ["node-agent", "presence"],
    queryFn: nodeAgentApi.presence,
    retry: false,
    refetchInterval: 2000,
  });
}

export function useNodeAgentProtocols() {
  return useQuery({
    queryKey: ["node-agent", "protocols"],
    queryFn: nodeAgentApi.protocols,
    retry: false,
    refetchInterval: 10000,
  });
}

export function useNodeAgentPresencePeers() {
  return useQuery({
    queryKey: ["node-agent", "presence-peers"],
    queryFn: nodeAgentApi.presencePeers,
    retry: false,
    refetchInterval: 2000,
  });
}
