import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { UserPlus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/friends")({
  component: FriendsPage,
});

type Friend = {
  id: string;
  name: string;
  handle: string;
  note?: string;
  addedAt: string;
};

const STORAGE_KEY = "trademind.friends.v1";

function readFriends(): Friend[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Friend[]) : [];
  } catch {
    return [];
  }
}

function writeFriends(list: Friend[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function FriendsPage() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    setFriends(readFriends());
  }, []);

  function addFriend() {
    if (!name.trim()) {
      toast.error("Enter a name");
      return;
    }
    const f: Friend = {
      id: crypto.randomUUID(),
      name: name.trim(),
      handle: handle.trim(),
      note: note.trim() || undefined,
      addedAt: new Date().toISOString(),
    };
    const next = [f, ...friends];
    setFriends(next);
    writeFriends(next);
    setName("");
    setHandle("");
    setNote("");
    toast.success(`${f.name} added`);
  }

  function removeFriend(id: string) {
    const next = friends.filter((f) => f.id !== id);
    setFriends(next);
    writeFriends(next);
  }

  const filtered = friends.filter((f) => {
    const q = query.toLowerCase();
    return (
      !q ||
      f.name.toLowerCase().includes(q) ||
      f.handle.toLowerCase().includes(q) ||
      (f.note ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
        <header className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Friends</h1>
            <p className="text-sm text-muted-foreground">
              All of your trading friends in one place.
            </p>
          </div>
        </header>

        <Card className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Handle (e.g. @trader)"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <Input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={addFriend}>
              <UserPlus className="mr-2 h-4 w-4" /> Add friend
            </Button>
          </div>
        </Card>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search friends"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            {friends.length === 0
              ? "No friends yet. Add your first one above."
              : "No friends match your search."}
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((f) => (
              <Card key={f.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="truncate font-medium">{f.name}</div>
                  {f.handle && (
                    <div className="truncate text-xs text-muted-foreground">
                      {f.handle}
                    </div>
                  )}
                  {f.note && (
                    <div className="mt-2 text-sm text-muted-foreground">{f.note}</div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFriend(f.id)}
                  aria-label={`Remove ${f.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
