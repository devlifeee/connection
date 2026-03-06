import { useMutation, useQuery } from "@tanstack/react-query";
import { nodeAgentApi, type ChatSendRequest, type ChatSendResponse } from "@/api/nodeAgent";

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

export function useUpdatePresence() {
  return useMutation({
    mutationFn: (displayName: string) => nodeAgentApi.updatePresence(displayName),
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

export function useNodeAgentSessions() {
  return useQuery({
    queryKey: ["node-agent", "sessions"],
    queryFn: nodeAgentApi.getSessions,
    retry: false,
    refetchInterval: 5000,
  });
}

export function useSendChatMessage() {
  return useMutation<ChatSendResponse, Error, ChatSendRequest>({
    mutationFn: (body) => nodeAgentApi.sendChat(body),
  });
}

export function useChatHistory(peerId: string | undefined) {
  return useQuery({
    queryKey: ["node-agent", "chat-history", peerId],
    queryFn: () => nodeAgentApi.chatHistory(peerId!, 50),
    enabled: !!peerId,
    refetchInterval: 2000,
  });
}

export function useFileTransfers() {
  return useQuery({
    queryKey: ["node-agent", "file-transfers"],
    queryFn: nodeAgentApi.getTransfers,
    retry: false,
    refetchInterval: 1000,
  });
}

export function useSendFile() {
  return useMutation({
    mutationFn: ({ peerId, file }: { peerId: string; file: File }) => 
      nodeAgentApi.sendFile(peerId, file),
  });
}