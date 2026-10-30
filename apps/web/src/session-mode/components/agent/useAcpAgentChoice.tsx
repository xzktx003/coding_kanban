import { chooseAcpAgent } from "@session/services/acpAgentChoice";
import { useSessionActionConfirmation } from "../common/useSessionActionConfirmation";
import { toast } from "../ui/use-toast";

export function useAcpAgentChoice() {
  const { ask, confirmation } = useSessionActionConfirmation();
  const selectAcp = async (id: string) => {
    try {
      await chooseAcpAgent(id, ask);
    } catch (error) {
      toast({
        title: "无法切换 Agent",
        description: String(error),
        variant: "destructive",
      });
    }
  };
  return { selectAcp, confirmation };
}
