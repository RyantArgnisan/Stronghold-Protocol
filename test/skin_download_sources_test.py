import importlib.util, pathlib, unittest
spec=importlib.util.spec_from_file_location('fetch_skin',pathlib.Path(__file__).parents[1]/'tools/fetch-skin-assets.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class SkinSources(unittest.TestCase):
 def test_actual_front_can_try_upstream_spine_directory(self):
  urls=mod.sources('https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_1012_skadi2/char_1012_skadi2_boc_4/Front/char_1012_skadi2_boc_4.skel')
  self.assertTrue(any('/Spine/' in u for u in urls))
  self.assertLessEqual(len(urls),4)
 def test_back_never_masquerades_as_front(self):
  urls=mod.sources('https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char/skin/Back/skin.skel')
  self.assertFalse(any('/Front/' in u or '/Spine/' in u for u in urls))
 def test_sources_refuse_other_hosts(self):
  with self.assertRaises(ValueError):mod.sources('https://evil.example/model.skel')
if __name__=='__main__':unittest.main()
