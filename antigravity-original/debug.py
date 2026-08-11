import tests.test_stealthit as t
import sys
import threading
import time

def hang_detector():
    time.sleep(5)
    print("Hang detected! Exiting.")
    import os
    os._exit(1)
threading.Thread(target=hang_detector, daemon=True).start()

def trace(frame, event, arg):
    if event == 'line' and 'main.py' in frame.f_code.co_filename and frame.f_lineno > 1490:
        print(frame.f_code.co_name, frame.f_lineno)
    return trace

sys.settrace(trace)
print('creating window')
w = t.main.MainWindow()
print('created window')
sys.settrace(None)
