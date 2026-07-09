import subprocess
import sys
import os
from pathlib import Path

def run_command(title, command, cwd):
    """Run a command in a subprocess."""
    print(f"[{title}] Starting...")
    print(f"[{title}] Command: {command}")
    print(f"[{title}] Directory: {cwd}")
    print("-" * 50)
    
    process = subprocess.Popen(
        command,
        shell=True,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True
    )
    return process

def main():
    project_root = Path(__file__).parent
    backend_dir = project_root / "backend"
    frontend_dir = project_root / "frontend"
    
    print("=" * 60)
    print("Starting AI Voice Assistant - All Services")
    print("=" * 60)
    print()
    
    # Check if directories exist
    if not backend_dir.exists():
        print(f"[ERROR] Backend directory not found: {backend_dir}")
        sys.exit(1)
    if not frontend_dir.exists():
        print(f"[ERROR] Frontend directory not found: {frontend_dir}")
        sys.exit(1)
    
    # Start Backend API
    backend_cmd = "venv\\Scripts\\activate && python -m app.main"
    backend_process = run_command("Backend API", backend_cmd, backend_dir)
    
    # Start LiveKit Agent
    agent_cmd = "venv\\Scripts\\activate && python app\\agent.py dev"
    agent_process = run_command("LiveKit Agent", agent_cmd, backend_dir)
    
    # Start Frontend
    frontend_cmd = "npm run dev"
    frontend_process = run_command("Frontend", frontend_cmd, frontend_dir)
    
    print()
    print("=" * 60)
    print("All services started!")
    print("=" * 60)
    print("Backend API: http://localhost:8000")
    print("Frontend: http://localhost:5173")
    print("LiveKit Agent: Running")
    print("=" * 60)
    print()
    print("Press Ctrl+C to stop all services")
    print()
    
    processes = [
        ("Backend API", backend_process),
        ("LiveKit Agent", agent_process),
        ("Frontend", frontend_process)
    ]
    
    try:
        # Stream output from all processes
        while True:
            for name, process in processes:
                if process.poll() is not None:
                    print(f"[{name}] Process exited with code {process.returncode}")
                    processes.remove((name, process))
                
                # Read available output
                try:
                    while True:
                        line = process.stdout.readline()
                        if line:
                            print(f"[{name}] {line}", end='')
                        else:
                            break
                except:
                    pass
            
            if not processes:
                print("All processes have exited.")
                break
            
            import time
            time.sleep(0.1)
            
    except KeyboardInterrupt:
        print("\n\nStopping all services...")
        for name, process in processes:
            print(f"[{name}] Terminating...")
            process.terminate()
        
        # Wait for processes to terminate
        for name, process in processes:
            try:
                process.wait(timeout=5)
            except:
                process.kill()
        
        print("All services stopped.")

if __name__ == "__main__":
    main()
