"""
BAUD — Project Agent

Auto-discovery architecture:
- Scans modules/ directory for .py files with handle_command()
- Routes commands to discovered modules automatically
"""

import importlib
import os
import sys
from pathlib import Path
from typing import Any, List

PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

os.environ.setdefault("AIPASS_BRANCH_NAME", "baud")

from aipass.cli.apps.modules import console
from aipass.prax import logger

MODULES_DIR = Path(__file__).parent / "modules"


def _module_import_path(stem: str) -> str:
    for prefix in (
        f"aipass.baud.apps.modules.{stem}",
        f"apps.modules.{stem}",
    ):
        try:
            importlib.import_module(prefix)
            return prefix
        except ImportError:
            continue
    return f"apps.modules.{stem}"


def discover_modules() -> List[Any]:
    """Auto-discover modules in modules/ directory."""
    modules = []
    if not MODULES_DIR.exists():
        return modules
    for file_path in MODULES_DIR.glob("*.py"):
        if file_path.name.startswith("_"):
            continue
        module_name = _module_import_path(file_path.stem)
        try:
            module = importlib.import_module(module_name)
            if hasattr(module, "handle_command"):
                modules.append(module)
        except Exception as e:
            logger.error("[BAUD] Failed to load module %s: %s", module_name, e)
    return modules


def route_command(command: str, args: List[str], modules: List[Any]) -> bool:
    """Route command to appropriate module."""
    for module in modules:
        try:
            if module.handle_command(command, args):
                return True
        except Exception as e:
            logger.error("[BAUD] Module %s error: %s", module.__name__, e)
    return False


def print_introspection() -> None:
    """Bare invocation — title, purpose, module list, help pointer."""
    console.print()
    console.print("[bold cyan]BAUD — Project Agent[/bold cyan]")
    console.print("[dim]Resident agent of the baud project.[/dim]")
    console.print()
    modules = discover_modules()
    if modules:
        console.print("[yellow]Modules:[/yellow]")
        for m in modules:
            cmd = getattr(m, "COMMAND", m.__name__.split(".")[-1])
            desc = (m.__doc__ or "").strip().split("\n")[0]
            console.print(f"  [green]{cmd:16}[/green] [dim]{desc}[/dim]")
        console.print()
    console.print("[dim]Run 'drone @baud --help' for usage information[/dim]")
    console.print()


def print_help() -> None:
    """Full help — usage, commands, examples."""
    console.print()
    console.print("[bold cyan]BAUD — Project Agent[/bold cyan]")
    console.print()
    console.print("[dim]Resident agent of the baud project.[/dim]")
    console.print()
    console.print("[yellow]Usage:[/yellow]")
    console.print("  [green]drone @baud[/green] [dim]<command>[/dim]")
    console.print()
    console.print("[yellow]Commands:[/yellow]")
    console.print("  [green]hello[/green]     [dim]Confirm the agent is alive[/dim]")
    modules = discover_modules()
    for m in modules:
        cmd = getattr(m, "COMMAND", m.__name__.split(".")[-1])
        desc = (m.__doc__ or "").strip().split("\n")[0]
        console.print(f"  [green]{cmd:10}[/green] [dim]{desc}[/dim]")
    console.print()
    console.print("[yellow]Examples:[/yellow]")
    console.print()
    console.print("  [dim]# Check the agent is alive[/dim]")
    console.print("  [green]drone @baud hello[/green]")
    console.print()
    console.print("  [dim]# Show connected modules[/dim]")
    console.print("  [green]drone @baud[/green]")
    console.print()


def main():
    """Main entry point."""
    args = sys.argv[1:]

    if not args:
        print_introspection()
        return 0

    if args[0] in ("--help", "-h", "help"):
        print_help()
        return 0

    if args[0] == "hello":
        console.print("[cyan]BAUD[/cyan] here. Project agent, alive and ready.")
        return 0

    command = args[0]
    remaining = args[1:] if len(args) > 1 else []
    modules = discover_modules()

    if remaining and remaining[0] in ("--help", "-h"):
        remaining = ["--help"]

    if route_command(command, remaining, modules):
        return 0

    console.print(f"Unknown command: {command}")
    console.print("[dim]Run 'drone @baud --help' for usage information[/dim]")
    return 1


if __name__ == "__main__":
    if sys.platform == "win32":
        os.environ.setdefault("PYTHONUTF8", "1")
        for _stream in (sys.stdout, sys.stderr):
            _reconfigure = getattr(_stream, "reconfigure", None)
            if _reconfigure is not None:
                _reconfigure(encoding="utf-8", errors="replace")

    try:
        sys.exit(main())
    except KeyboardInterrupt:
        logger.warning("BAUD interrupted by user (KeyboardInterrupt)")
        console.print("\n\nOperation cancelled by user")
        sys.exit(0)
    except Exception as e:
        logger.error("BAUD entry point error: %s", e, exc_info=True)
        console.print(f"\nError: {e}")
        sys.exit(1)
