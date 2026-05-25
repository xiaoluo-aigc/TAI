import { Button } from "@/components/ui/button";
import {
  buildOpenObserveFailureUrl,
  canOpenObserveLogJump,
  type LogJumpRecord,
} from "@/utils/openobserve";

type OpenObserveLogButtonProps = {
  record: LogJumpRecord;
  className?: string;
};

export function OpenObserveLogButton({
  record,
  className,
}: OpenObserveLogButtonProps) {
  const canJump = canOpenObserveLogJump(record);

  const handleClick = () => {
    if (!canJump || typeof window === "undefined") return;
    window.open(
      buildOpenObserveFailureUrl(record),
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <Button
      variant='outline'
      size='sm'
      className={className}
      disabled={!canJump}
      title={
        canJump
          ? "跳转到 OpenObserve logs 页查看关联日志"
          : "当前记录缺少可检索的 apiUsageId / traceId / taskId / requestId"
      }
      onClick={handleClick}
    >
      查看 OpenObserve 日志
    </Button>
  );
}
