"""Integration-like test of router dispatch with a fake AGY executable (no cloud calls)."""
import importlib.util, json, os, pathlib, subprocess, sys, tempfile, time, types, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]

class RouterMockTests(unittest.TestCase):
    def test_submit_and_completion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp); home=root/'home'; home.mkdir(); repo=root/'project'; repo.mkdir()
            for args in [('init',),('config','user.email','test@example.com'),('config','user.name','Test')]:
                subprocess.run(['git',*args],cwd=repo,check=True,capture_output=True)
            (repo/'README.md').write_text('demo')
            subprocess.run(['git','add','.'],cwd=repo,check=True,capture_output=True)
            subprocess.run(['git','commit','-m','init'],cwd=repo,check=True,capture_output=True)
            subprocess.run(['git','checkout','-b','ai/mock-test'],cwd=repo,check=True,capture_output=True)
            agy=root/'fake_agy'
            agy.write_text('#!'+sys.executable+'\nimport json\nprint(json.dumps({"status":"SUCCESS","response":"MOCK_OK","conversation_id":"abc-123","usage":{"total_tokens":9}}))\n')
            agy.chmod(0o755)
            config=root/'workers.json'
            config.write_text(json.dumps({'workers':[{'id':'mock','home':str(home),'workspace':str(repo),'executable':str(agy),'timeout_sec':30}]}))
            os.environ['AGY_ROUTER_CONFIG']=str(config); os.environ['AGY_ROUTER_STATE']=str(root/'state')
            # Stub SDK merely for internal router test; real MCP handshake still requires SDK.
            fake=types.ModuleType('mcp'); fake_server=types.ModuleType('mcp.server'); fake_fast=types.ModuleType('mcp.server.fastmcp')
            class FastMCP:
                def __init__(self,*a): pass
                def tool(self): return lambda f:f
            fake_fast.FastMCP=FastMCP
            backup={k:sys.modules.get(k) for k in ['mcp','mcp.server','mcp.server.fastmcp']}
            sys.modules.update({'mcp':fake,'mcp.server':fake_server,'mcp.server.fastmcp':fake_fast})
            try:
                spec=importlib.util.spec_from_file_location('agy_router_test_module',ROOT/'router.py')
                module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
                task=module.submit_task('mock','Only report OK')
                for _ in range(100):
                    result=module.get_task(task['task_id'])
                    if result['status'] not in ('QUEUED','RUNNING'): break
                    time.sleep(.05)
                self.assertEqual(result['status'],'DONE',result)
                self.assertEqual(result['response'],'MOCK_OK')
                self.assertEqual(result['conversation_id'],'abc-123')
                self.assertEqual(result['usage']['total_tokens'],9)
            finally:
                for k,v in backup.items():
                    if v is None: sys.modules.pop(k,None)
                    else: sys.modules[k]=v
                os.environ.pop('AGY_ROUTER_CONFIG',None); os.environ.pop('AGY_ROUTER_STATE',None)
if __name__=='__main__': unittest.main()
