import { useEffect, useState, useCallback, useRef } from 'react';
import type { HubConnection } from '@microsoft/signalr';

interface GameTimerProps {
  connection: HubConnection | null;
  roomCode: string;
  timeLimitSeconds: number | null;
  startedAt: string | null; // ISO date string from server
  onTimerExpired?: () => void;
}

export default function GameTimer({
  connection,
  roomCode,
  timeLimitSeconds,
  startedAt,
  onTimerExpired,
}: GameTimerProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [serverStartedAt, setServerStartedAt] = useState<Date | null>(
    startedAt ? new Date(startedAt) : null
  );
  const [expired, setExpired] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const hasNotifiedExpiry = useRef(false);

  // Listen for timer events from server
  useEffect(() => {
    if (!connection) return;

    const onTimerStarted = (startTime: string, limit: number | null) => {
      setServerStartedAt(new Date(startTime));
      if (limit) {
        // Recalculate remaining
        const elapsed = (Date.now() - new Date(startTime).getTime()) / 1000;
        setRemainingSeconds(Math.max(0, Math.ceil(limit - elapsed)));
      }
    };

    const onTimerExpiredEvent = () => {
      setExpired(true);
      setRemainingSeconds(0);
    };

    connection.on('TimerStarted', onTimerStarted);
    connection.on('TimerExpired', onTimerExpiredEvent);

    return () => {
      connection.off('TimerStarted', onTimerStarted);
      connection.off('TimerExpired', onTimerExpiredEvent);
    };
  }, [connection]);

  // Start the timer if it hasn't started yet (first player to load triggers it)
  const startTimer = useCallback(() => {
    if (!connection || !roomCode || !timeLimitSeconds) return;
    if (serverStartedAt) return; // Already started
    connection.invoke('StartTimer', roomCode).catch(() => {});
  }, [connection, roomCode, timeLimitSeconds, serverStartedAt]);

  // Auto-start timer on mount if time limit is set
  useEffect(() => {
    if (timeLimitSeconds && !serverStartedAt) {
      // Small delay to ensure connection is ready
      const timeout = setTimeout(startTimer, 500);
      return () => clearTimeout(timeout);
    }
  }, [timeLimitSeconds, serverStartedAt, startTimer]);

  // Tick the countdown
  useEffect(() => {
    if (!timeLimitSeconds || !serverStartedAt) {
      setRemainingSeconds(null);
      return;
    }

    const tick = () => {
      const elapsed = (Date.now() - serverStartedAt.getTime()) / 1000;
      const remaining = Math.max(0, Math.ceil(timeLimitSeconds - elapsed));
      setRemainingSeconds(remaining);

      if (remaining <= 0 && !hasNotifiedExpiry.current) {
        hasNotifiedExpiry.current = true;
        setExpired(true);
        onTimerExpired?.();
        // Notify server
        if (connection) {
          connection.invoke('TimerExpired', roomCode).catch(() => {});
        }
      }
    };

    tick(); // immediate
    timerRef.current = setInterval(tick, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timeLimitSeconds, serverStartedAt, connection, roomCode, onTimerExpired]);

  // Update serverStartedAt when prop changes
  useEffect(() => {
    if (startedAt) {
      setServerStartedAt(new Date(startedAt));
    }
  }, [startedAt]);

  // Don't render if no time limit
  if (!timeLimitSeconds) return null;

  const total = timeLimitSeconds;
  const remaining = remainingSeconds ?? total;
  const fraction = remaining / total;

  // Color logic
  let colorClass = 'text-white';
  let bgClass = 'bg-gray-700';
  let barColor = 'bg-blue-500';
  if (expired) {
    colorClass = 'text-red-400';
    bgClass = 'bg-red-900/30 border border-red-700/50';
    barColor = 'bg-red-500';
  } else if (fraction <= 0.1) {
    colorClass = 'text-red-400 animate-pulse';
    bgClass = 'bg-red-900/20 border border-red-700/30';
    barColor = 'bg-red-500';
  } else if (fraction <= 0.25) {
    colorClass = 'text-yellow-400';
    bgClass = 'bg-yellow-900/20 border border-yellow-700/30';
    barColor = 'bg-yellow-500';
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className={`rounded-xl px-4 py-3 ${bgClass} transition-all`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">
          {expired ? '⏰ Time Up!' : '⏱ Time'}
        </span>
        <span className={`font-mono text-2xl font-bold tabular-nums ${colorClass}`}>
          {display}
        </span>
      </div>
      {/* Progress bar */}
      <div className="w-full h-1.5 bg-gray-600 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-linear ${barColor}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}
