from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json, os
ROOT='/mnt/data/ph_227/homeassistant_apps/printhub/web'
os.chdir(ROOT)
class H(SimpleHTTPRequestHandler):
    def do_GET(self):
        p=self.path.split('?',1)[0]
        if p=='/api/overview':
            data={'cups':{'schedulerRunning':True,'defaultDestination':'XP365B'},'printers':[{'name':'XP365B','enabled':True,'accepting':True,'uri':'usb://Xprinter/XP-365B','description':'Xprinter XP-365B','location':'PrintHub','stateText':'printer XP365B is idle.'}], 'activeJobs':[], 'classes':[], 'agent':{'serverConnected':True,'agentId':'homeassistant-xp365b'}, 'version':'2.2.6'}
            return self.js(data)
        if p=='/api/jobs':
            return self.js({'jobs':[{'id':'XP365B-1','destination':'XP365B','owner':'root','sizeBytes':1234,'dateText':'Mon 18 Aug 2026','completed':False}]})
        if p=='/api/printers':
            return self.js({'printers':[{'name':'XP365B','enabled':True,'accepting':True,'uri':'usb://Xprinter/XP-365B','description':'Xprinter XP-365B','location':'PrintHub','stateText':'printer XP365B is idle.'}]})
        if p=='/api/classes': return self.js({'classes':[]})
        if p=='/api/server': return self.js({'server':{},'status':{'schedulerRunning':True,'schedulerText':'scheduler is running','defaultDestination':'XP365B'}})
        if p=='/api/devices': return self.js({'devices':[]})
        if p=='/api/drivers': return self.js({'drivers':[]})
        if p=='/api/agent': return self.js({'agent':{'serverConnected':True,'agentId':'homeassistant-xp365b','cupsSchedulerRunning':True}})
        if p=='/api/logs': return self.js({'logs':{}})
        # app-select bundle intentionally absent -> fallback path tested.
        return super().do_GET()
    def js(self,obj):
        raw=json.dumps(obj).encode(); self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def log_message(self,fmt,*args): pass
ThreadingHTTPServer(('127.0.0.1',8123),H).serve_forever()
