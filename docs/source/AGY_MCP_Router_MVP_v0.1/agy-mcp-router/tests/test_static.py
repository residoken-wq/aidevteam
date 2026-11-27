import json, pathlib, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class StaticTests(unittest.TestCase):
    def test_config(self):
        cfg=json.loads((ROOT/'config/workers.example.json').read_text())
        self.assertEqual(len({x['id'] for x in cfg['workers']}),2)
    def test_claude_json(self):
        cfg=json.loads((ROOT/'config/claude_desktop_config.example.json').read_text())
        self.assertIn('agy-router',cfg['mcpServers'])
    def test_script_exists(self): self.assertTrue((ROOT/'router.py').exists())
if __name__=='__main__': unittest.main()
