import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFreeTierFlag } from "@/lib/flags.functions";

/** True once the permanent free tier is live; drives public-page copy. */
export function useFreeTierFlag(): boolean {
  const fetchFlag = useServerFn(getFreeTierFlag);
  const { data } = useQuery({
    queryKey: ["free-tier-flag"],
    queryFn: () => fetchFlag(),
    staleTime: 5 * 60_000,
  });
  return !!data?.enabled;
}
