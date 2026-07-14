import type { County } from "@scrubjay/api-contracts";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchCounties } from "@/server/functions/ebird";

interface AddSubscriptionFormProps {
  onSubmit: (regionCode: string) => Promise<void>;
}

export function AddSubscriptionForm({ onSubmit }: AddSubscriptionFormProps) {
  const [busy, setBusy] = useState(false);
  const [counties, setCounties] = useState<County[]>([]);
  const [county, setCounty] = useState("*");
  const [stateCode, setStateCode] = useState("");

  async function loadCounties(nextState: string) {
    setStateCode(nextState);
    setCounty("*");
    setCounties([]);
    if (!/^[A-Z]{2}-[A-Z0-9]{1,10}$/.test(nextState)) return;
    try {
      const response = await fetchCounties({ data: { stateCode: nextState } });
      setCounties(response.counties);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const regionCode = county === "*" ? stateCode : county;
        if (!regionCode) return;
        setBusy(true);
        void onSubmit(regionCode).finally(() => setBusy(false));
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="stateCode">State (e.g. US-CA)</Label>
        <Input
          className="w-32 font-mono uppercase"
          id="stateCode"
          onChange={(event) =>
            void loadCounties(event.target.value.toUpperCase())
          }
          placeholder="US-CA"
          value={stateCode}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>County</Label>
        <Select
          onValueChange={(value) => setCounty(value ?? "*")}
          value={county}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="*">Statewide</SelectItem>
            {counties.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button disabled={busy || stateCode.length === 0} type="submit">
        Add subscription
      </Button>
    </form>
  );
}
